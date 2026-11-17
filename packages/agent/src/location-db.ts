// The location database (IP address to country, city and time zone) the browser image reads
// when it checks a proxy and makes a fingerprint. The image carries the copy it was built
// with; a monthly workflow in enclave-releases publishes a checked newer one, and this keeps
// the PC's copy current: it downloads it, verifies it, puts it in a Docker volume, and
// containers get that volume read-only over the image's copy.
//
// A newer database only changes where an IP is said to be. Fingerprints are never touched,
// and a profile whose IP now maps to another time zone is refused at start ("Update
// location"), as when a proxy moves.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type Docker from 'dockerode';
import type { DockerRuntime } from './docker/runtime.js';
import { tarEnd, tarHeader, tarPadding } from './docker/tar.js';

const RELEASE =
  'https://github.com/johnabiotic-netizen/enclave-releases/releases/download/location-database/';
export const LOCATION_DB_MANIFEST = `${RELEASE}location-database.json`;
/** Where the camoufox package looks for its database in the image (Dockerfile). */
const TARGET = '/opt/session-cache/camoufox/geoip/mmdb';
const FILE_NAME = 'geoip aio by daijro-combined.mmdb';
const VOLUME_LABEL = 'enclave.location-db';
/** How often to ask for a newer database; the workflow publishes monthly. */
const CHECK_EVERY_MS = 24 * 60 * 60_000;
const MAX_BYTES = 400 * 1024 * 1024;

export interface LocationDbManifest {
  format: 1;
  tag: string;
  file: string;
  /** Of the database itself. */
  sha256: string;
  /** Of the gzipped file. */
  gzSha256: string;
  bytes: number;
  publishedAt: string;
}

interface State {
  tag: string;
  volume: string;
  sha256: string;
  installedAt: string;
  checkedAt?: string;
}

export function validManifest(m: unknown): m is LocationDbManifest {
  const x = m as Partial<LocationDbManifest> | null;
  return (
    !!x &&
    x.format === 1 &&
    typeof x.tag === 'string' &&
    /^\d{4}\.\d{2}\.\d{2}$/.test(x.tag) &&
    typeof x.file === 'string' &&
    x.file === `location-database-${x.tag}.mmdb.gz` &&
    typeof x.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.sha256) &&
    typeof x.gzSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(x.gzSha256) &&
    typeof x.bytes === 'number' &&
    x.bytes > 1024 * 1024 &&
    x.bytes < MAX_BYTES
  );
}

/** Counts and hashes the bytes passing through. */
function hashing(): Transform & { digest(): string; bytes: number } {
  const hash = createHash('sha256');
  const t = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      t.bytes += chunk.length;
      done(null, chunk);
    },
  }) as Transform & { digest(): string; bytes: number };
  t.bytes = 0;
  t.digest = () => hash.digest('hex');
  return t;
}

export class LocationDb {
  private state: State | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly runtime: DockerRuntime,
    private readonly home: string,
    private readonly log: (event: string, data?: Record<string, unknown>) => void = () => {},
  ) {}

  private get stateFile(): string {
    return path.join(this.home, 'location-db.json');
  }

  private get workDir(): string {
    return path.join(this.home, 'location-db');
  }

  /** Reads what is installed; call once before containers start. */
  async load(): Promise<void> {
    let s: State;
    try {
      s = JSON.parse(await readFile(this.stateFile, 'utf8')) as State;
    } catch {
      this.state = null;
      return;
    }
    try {
      await this.runtime.docker.getVolume(s.volume).inspect();
      this.state = s;
    } catch (e) {
      // The volume is gone (Docker was reset): the image's own copy until the next download.
      // Docker not answering says nothing about the volume, so the state stays.
      this.state = (e as { statusCode?: number }).statusCode === 404 ? null : s;
    }
  }

  /** The newer database for a container, read-only over the image's copy; none until one is installed. */
  mounts(): Docker.MountSettings[] {
    if (!this.state) return [];
    return [{ Type: 'volume', Source: this.state.volume, Target: TARGET, ReadOnly: true }];
  }

  /** The installed database's release, or null for the image's own copy. */
  version(): string | null {
    return this.state?.tag ?? null;
  }

  /** Checks now, then about once a day. */
  start(): void {
    const tick = () =>
      void this.update().catch((e: unknown) =>
        this.log('location-db-failed', { error: String(e) }),
      );
    setTimeout(tick, 60_000).unref();
    this.timer = setInterval(tick, 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Downloads and installs a newer database if there is one. One at a time. */
  update(force = false): Promise<void> {
    this.running ??= this.doUpdate(force).finally(() => (this.running = null));
    return this.running;
  }

  private async doUpdate(force: boolean): Promise<void> {
    const checkedAt = this.state?.checkedAt ? Date.parse(this.state.checkedAt) : 0;
    if (!force && Date.now() - checkedAt < CHECK_EVERY_MS) return;
    if (!(await this.runtime.ping())) return;

    const res = await fetch(LOCATION_DB_MANIFEST, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`location database list: HTTP ${res.status}`);
    const manifest: unknown = await res.json();
    if (!validManifest(manifest)) throw new Error('location database list is not valid');
    if (this.state?.tag === manifest.tag) {
      await this.saveState({ ...this.state, checkedAt: new Date().toISOString() });
      return;
    }
    // Never go back to an older database than the one installed.
    if (this.state && manifest.tag < this.state.tag) return;

    await mkdir(this.workDir, { recursive: true });
    const gz = path.join(this.workDir, `${manifest.file}.part`);
    const db = path.join(this.workDir, 'database.mmdb.part');
    try {
      // 1. The gzipped file, checked against the list.
      const dl = await fetch(`${RELEASE}${manifest.file}`, {
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!dl.ok || !dl.body) throw new Error(`location database: HTTP ${dl.status}`);
      const gzHash = hashing();
      await pipeline(
        Readable.fromWeb(dl.body as import('node:stream/web').ReadableStream),
        gzHash,
        createWriteStream(gz),
      );
      if (gzHash.digest() !== manifest.gzSha256)
        throw new Error('location database download is damaged');

      // 2. The database itself, checked again.
      const dbHash = hashing();
      await pipeline(createReadStream(gz), createGunzip(), dbHash, createWriteStream(db));
      if (dbHash.digest() !== manifest.sha256 || dbHash.bytes !== manifest.bytes) {
        throw new Error('location database is damaged');
      }
      await rm(gz, { force: true });

      // 3. Into a new volume, then the switch.
      const volume = `enclave-location-${manifest.tag.replace(/\./g, '-')}`;
      await this.runtime.docker
        .createVolume({ Name: volume, Labels: { [VOLUME_LABEL]: manifest.tag } })
        .catch(() => {});
      const size = (await stat(db)).size;
      await this.runtime.withVolume(volume, false, async (c) => {
        const tar = Readable.from(
          (async function* () {
            yield tarHeader(FILE_NAME, size, 0o644);
            for await (const chunk of createReadStream(db)) yield chunk as Buffer;
            yield tarPadding(size);
            yield tarEnd();
          })(),
        );
        await c.putArchive(tar, { path: '/data' });
      });
      const old = this.state?.volume;
      await this.saveState({
        tag: manifest.tag,
        volume,
        sha256: manifest.sha256,
        installedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
      });
      this.log('location-db-installed', { tag: manifest.tag, previous: old ?? 'image' });
      // A running profile may still use the old one; then it goes at the next update.
      await this.removeUnused();
    } finally {
      await rm(gz, { force: true }).catch(() => {});
      await rm(db, { force: true }).catch(() => {});
    }
  }

  /** Older database volumes no container uses any more. */
  private async removeUnused(): Promise<void> {
    const { Volumes } = await this.runtime.docker.listVolumes({
      filters: { label: [VOLUME_LABEL] },
    });
    for (const v of Volumes ?? []) {
      if (v.Name === this.state?.volume) continue;
      await this.runtime.docker
        .getVolume(v.Name)
        .remove()
        .catch(() => {});
    }
  }

  private async saveState(s: State): Promise<void> {
    this.state = s;
    const tmp = `${this.stateFile}.part`;
    await writeFile(tmp, JSON.stringify(s, null, 2));
    await rename(tmp, this.stateFile);
  }
}

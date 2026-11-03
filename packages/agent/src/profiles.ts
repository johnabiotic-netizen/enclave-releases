// Profile lifecycle: create (safety check + fingerprint), start, stop, delete, idle stop.

import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import net from 'node:net';
import type Docker from 'dockerode';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_IDLE_STOP_MINUTES,
  DESKTOP_APP_ORIGIN,
  type CheckNewProxyRequest,
  type CreateProfileRequest,
  type DownloadedFile,
  MAX_DOWNLOAD_BYTES,
  type Fingerprint,
  type MediaInUse,
  type PcTurn,
  type Profile,
  type ProfileStatus,
  type ProxyCheckResult,
  type ProxyReport,
  type ProxyTestRequest,
  type ProxyInput,
  type ProxySpec,
  type StreamInfo,
  type SystemResponse,
  type UpdateProfileRequest,
} from '@enclave/shared';
import type { AgentConfig } from './config.js';
import { PROFILE_LABEL, type DockerRuntime } from './docker/runtime.js';
import { makeTar, type TarEntry } from './docker/tar.js';
import { detectGpu, gpuContainerSettings } from './gpu.js';
import type { TailnetAddress, Tailscale } from './tailscale.js';
import { evaluateAudit, summarize, type Finding, type Reference } from './audit-readers.js';
import { lookupReputation, ProxyTester, type ProxyTestJob } from './proxy-tester.js';
import { AgentError, InputError } from './errors.js';
import { stripLocation } from './strip-location.js';
import {
  checkPassphrase,
  createManifestSplit,
  createOpenStream,
  createSealStream,
  createTarFilter,
  keepOnExport,
  keepOnImport,
  manifestBlock,
  type ProfileFileManifest,
} from './profile-file.js';
import { nekoLogin, nekoReachable, nekoSessions } from './neko.js';
import { describeProxy, judgeProxyCheck, parseProxy, type RawProxyCheck } from './proxy.js';
import { PROXY_SECRET_REF, type ProfileSecrets, type ProfileStore } from './store.js';

/** Host ports for streams: web client/API and the WebRTC mux, in pairs. Bound to 127.0.0.1. */
const PORT_RANGE = { first: 52100, last: 52998 };
const START_TIMEOUT_MS = 120_000;
const MONITOR_INTERVAL_MS = 60_000;
/** The stream password lives as long as the container; this is a nominal upper bound. */
const STREAM_TTL_MS = 24 * 60 * 60 * 1000;
const CONTAINER_MEMORY_BYTES = 3 * 1024 ** 3;
const SHM_BYTES = 2 * 1024 ** 3;
/** Where the profile's browser saves downloads (launch_browser.py RUNTIME_PREFS). */
const DOWNLOADS_DIR = '/data/downloads';
const PROXY_UNREACHABLE = 'Proxy unreachable';

/**
 * Stage 4: is a page using the camera or microphone? Run in the container as neko. The
 * camera is in use while a browser process maps the phone camera's shared memory (camfeed,
 * which writes it, always does); the microphone while something records from the
 * "microphone" source (its own loopback module aside); a file picker while Firefox's "File
 * Upload" dialog is on screen. Prints "<camera 0|1> <recordings> <pickers>".
 */
const MEDIA_IN_USE_SCRIPT = `cam=0
for d in /proc/[0-9]*; do
  grep -qs enclave-camera "$d/maps" || continue
  grep -qs camfeed "$d/cmdline" || cam=1
done
src=$(pactl list short sources | awk '$2 == "microphone" { print $1 }')
mic=$(pactl list short source-outputs | awk -v s="$src" '$2 == s && $4 == "protocol-native.c"' | wc -l)
pick=$(DISPLAY=:99.0 xdotool search --onlyvisible --name '^File Upload' | wc -l)
# The phone's side: its mic plays into the audio_input sink; its camera frames are under 3 s old.
in=$(pactl list short sinks | awk '$2 == "audio_input" { print $1 }')
pmic=$(pactl list short sink-inputs | awk -v s="$in" '$2 == s' | wc -l)
t=$(od -An -t u8 -j 24 -N 8 /dev/shm/enclave-camera 2>/dev/null | tr -d ' ')
[ -n "$t" ] || t=0
pcam=$(( t > 0 && $(date +%s%6N) - t < 3000000 ))
echo "$cam $mic $pick $pmic $pcam"`;

/**
 * Stage 4: types a file's path ($1) into Firefox's open file picker and confirms. Only while the
 * picker is the active window, so the path can never go into a web page instead.
 */
const FILL_PICKER_SCRIPT = `export DISPLAY=:99.0 LANG=C.UTF-8
w=$(xdotool search --onlyvisible --name '^File Upload' | head -1)
[ -n "$w" ] || exit 3
active() { [ "$(xdotool getactivewindow)" = "$w" ] || exit 4; }
xdotool windowactivate --sync "$w"
active
xdotool key --clearmodifiers ctrl+l
sleep 0.3
active
xdotool type --clearmodifiers --delay 10 "$1"
sleep 0.2
active
xdotool key --clearmodifiers Return`;

/**
 * A phone file's name as the site will see it: the phone's own name, without folders or
 * control characters, cut to fit a tar header (keeping the extension).
 */
export function phoneFileName(raw: string): string {
  let name = raw
    .replace(/^.*[\\/]/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name || name === '.' || name === '..') name = 'file';
  const max = 60; // bytes; the archive path around it takes the rest of 100
  if (Buffer.byteLength(name) > max) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && Buffer.byteLength(name.slice(dot)) <= 12 ? name.slice(dot) : '';
    let base = name.slice(0, name.length - ext.length);
    while (Buffer.byteLength(base + ext) > max) base = [...base].slice(0, -1).join('');
    name = base + ext;
  }
  return name;
}

const containerName = (id: string) => `enclave-${id}`;
const networkName = (id: string) => `enclave-${id}`;
const volumeName = (id: string) => `enclave-${id}-data`;
const randomPassword = () => randomBytes(18).toString('base64url');
const auditContainerName = (id: string) => `enclave-audit-${id}`;
/** Marks audit containers (testing/test-suite.md); not PROFILE_LABEL, so nothing mistakes one for the profile. */
const AUDIT_LABEL = 'enclave.audit';
/** The longest an audit run may take: every check's own timeout plus start-up. */
const AUDIT_TIMEOUT_MS = 20 * 60_000;
const AUDIT_POLL_MS = 5_000;

export class ProfileService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastViewerAt = new Map<string, number>();
  private readonly nekoTokens = new Map<string, string>();
  /** Audit runs started through the API, kept until the agent restarts. */
  private readonly auditJobs = new Map<string, AuditJob>();
  private proxyTester: ProxyTester | undefined;
  private monitor: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: AgentConfig,
    private readonly store: ProfileStore,
    private readonly runtime: DockerRuntime,
    /** Phone mode (ENCLAVE_PHONE=tailscale): relays streams to the tailnet. */
    private readonly phone?: Tailscale,
    /** Phone mode (ENCLAVE_PHONE=relay): the relay's TURN server, while the PC is linked. */
    private readonly relayTurn?: () => PcTurn | null,
    /** A newer location database than the image's (location-db.ts), mounted into containers. */
    private readonly locationDb?: { mounts(): Docker.MountSettings[] },
  ) {}

  /** The location database mount, for every container that looks up an IP's location. */
  private locationMounts(): Docker.MountSettings[] {
    return this.locationDb?.mounts() ?? [];
  }

  // ---------------------------------------------------------------- queries

  /** The person's profiles: not the proxy tester's temporary ones. */
  async list(): Promise<Profile[]> {
    return (await this.store.list()).filter((p) => !p.runtime.temporary);
  }

  get(id: string): Promise<Profile> {
    return this.store.get(id);
  }

  async stream(id: string): Promise<StreamInfo> {
    const profile = await this.store.get(id);
    const secrets = await this.store.getSecrets(id);
    if (profile.status.state !== 'running' || !profile.status.streamPort || !secrets.stream) {
      throw new AgentError(
        'PROFILE_NOT_RUNNING',
        `"${profile.name}" isn't running. Start it first.`,
      );
    }
    return streamInfo(profile.status.streamPort, secrets.stream);
  }

  /** The stream server's port of a running profile (the relay tunnel reaches it there). */
  async streamPort(id: string): Promise<number> {
    const profile = await this.store.get(id);
    if (profile.status.state !== 'running' || !profile.status.streamPort) {
      throw new AgentError(
        'PROFILE_NOT_RUNNING',
        `"${profile.name}" isn't running. Start it first.`,
      );
    }
    return profile.status.streamPort;
  }

  /** Stage 4: whether a page in the profile is using its camera or microphone now. */
  async media(id: string): Promise<MediaInUse> {
    await this.stream(id); // PROFILE_NOT_FOUND / PROFILE_NOT_RUNNING
    const out = await this.runtime.execOutput(
      containerName(id),
      ['sh', '-c', MEDIA_IN_USE_SCRIPT],
      'neko',
    );
    const [camera, microphone, pickers, phoneMic, phoneCam] = out.stdout
      .trim()
      .split(/\s+/)
      .map(Number);
    if (
      out.code !== 0 ||
      camera === undefined ||
      microphone === undefined ||
      pickers === undefined ||
      phoneMic === undefined ||
      phoneCam === undefined
    ) {
      throw new AgentError('INTERNAL', "Couldn't read the profile's camera and microphone state.");
    }
    return {
      camera: camera > 0,
      microphone: microphone > 0,
      filePicker: pickers > 0,
      phoneCamera: phoneCam > 0,
      phoneMicrophone: phoneMic > 0,
    };
  }

  /** What the running profile has downloaded (finished files only), newest first. */
  async downloads(id: string): Promise<DownloadedFile[]> {
    await this.streamPort(id); // running, or PROFILE_NOT_RUNNING
    const out = await this.runtime.execOutput(
      containerName(id),
      // Firefox writes a download as <name>.part and renames it when it is complete.
      [
        'find',
        DOWNLOADS_DIR,
        '-maxdepth',
        '1',
        '-type',
        'f',
        '!',
        '-name',
        '*.part',
        '-printf',
        '%s\\t%T@\\t%f\\0',
      ],
      'neko',
    );
    if (out.code !== 0) {
      throw new AgentError('INTERNAL', "Couldn't read the profile's downloads.");
    }
    return out.stdout
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [bytes = '0', at = '0', ...name] = line.split('\t');
        return {
          name: name.join('\t'),
          bytes: Number(bytes),
          modifiedAt: new Date(Number(at) * 1000).toISOString(),
        };
      })
      .filter((f) => f.name && !f.name.includes('/'))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /** One downloaded file's content. Only a name in the profile's own downloads list. */
  async download(id: string, name: string): Promise<{ file: DownloadedFile; data: Buffer }> {
    const file = (await this.downloads(id)).find((f) => f.name === name);
    if (!file) throw new InputError('No downloaded file with that name in this profile.');
    if (file.bytes > MAX_DOWNLOAD_BYTES) {
      throw new InputError('That file is over 500 MB. Use it inside the profile instead.');
    }
    const data = await this.runtime.getFile(
      containerName(id),
      `${DOWNLOADS_DIR}/${name}`,
      MAX_DOWNLOAD_BYTES,
    );
    await this.store.log(id, 'download-taken', { bytes: data.length });
    return { file, data };
  }

  /** Stage 4: puts a file from the phone into the profile and picks it in the open file picker. */
  async sendFile(id: string, name: string, data: Buffer): Promise<void> {
    if (!(await this.media(id)).filePicker) {
      throw new AgentError(
        'FILE_PICKER_CLOSED',
        'No file picker is open in the profile. Tap the upload field on the page first.',
      );
    }
    // A folder of its own per file, so two files with one name don't collide. Gone at stop.
    const dir = `tmp/from-phone/${randomBytes(4).toString('hex')}/`;
    const file = dir + phoneFileName(name);
    // The phone's real location must not reach a profile whose proxy is elsewhere.
    const locationRemoved = stripLocation(data) > 0;
    await this.runtime.putArchive(
      containerName(id),
      makeTar([
        { name: 'tmp/from-phone/', mode: 0o1777 },
        { name: dir, mode: 0o755 },
        { name: file, mode: 0o644, content: data },
      ]),
    );
    const code = await this.runtime.exec(
      containerName(id),
      ['sh', '-c', FILL_PICKER_SCRIPT, 'sh', `/${file}`],
      'neko',
    );
    if (code === 3) {
      throw new AgentError(
        'FILE_PICKER_CLOSED',
        'The file picker closed before the file arrived. Open it again and resend.',
      );
    }
    if (code !== 0) {
      throw new AgentError(
        'INTERNAL',
        "Couldn't hand the file to the profile's file picker. Try again.",
      );
    }
    await this.store.log(id, 'phone-file', { bytes: data.length, locationRemoved });
  }

  logs(id: string, tail: number): Promise<string[]> {
    return this.store.get(id).then(() => this.store.tailLog(id, tail));
  }

  async system(): Promise<SystemResponse> {
    const dockerOk = await this.runtime.ping();
    const profiles = await this.store.list();
    return {
      ram: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      profilesRunning: profiles.filter((p) => p.status.state === 'running').length,
      dockerOk,
      virtualizationOk: dockerOk,
      imageBuilt: dockerOk && (await this.runtime.imageExists()),
      testProxyAvailable: Boolean(this.config.testProxy),
      profileMemory: await Promise.all(
        profiles
          .filter((p) => p.status.state === 'running')
          .map(async (p) => ({
            id: p.id,
            bytes: dockerOk ? await this.runtime.memoryBytes(containerName(p.id)) : null,
          })),
      ),
    };
  }

  /**
   * The safety check for a proxy that is not in a profile yet (the create wizard's Check):
   * the same check a profile's start runs. Throws the same errors; saves nothing.
   */
  /** The wizard's Check proxy: the safety check, and what IP databases say about the exit IP. */
  async checkNewProxy(req: CheckNewProxyRequest): Promise<ProxyReport> {
    const useTestProxy = req.useTestProxy === true;
    const proxy = this.wizardProxy(req.proxy, useTestProxy);
    await this.runtime.assertReady();
    const result: ProxyReport = checkResult(await this.checkProxy(proxy, useTestProxy), true);
    // Not for the test proxy: that is this PC's own connection.
    if (result.exitIp && !useTestProxy) {
      const reputation = (await lookupReputation([result.exitIp])).get(result.exitIp);
      if (reputation) result.reputation = reputation;
    }
    return result;
  }

  private wizardProxy(spec: ProxySpec | undefined, useTestProxy: boolean): ProxyInput {
    if (useTestProxy) {
      if (!this.config.testProxy) throw new InputError('No test proxy is set up on this PC.');
      return parseProxy(this.config.testProxy);
    }
    if (!spec) throw new InputError('A proxy is required (or use the test proxy).');
    return parseProxy(spec);
  }

  // ---------------------------------------------------------------- create / update / delete

  async create(req: CreateProfileRequest, opts: { temporary?: boolean } = {}): Promise<Profile> {
    const name = validName(req.name);
    const useTestProxy = req.useTestProxy === true;
    const proxy = this.wizardProxy(req.proxy, useTestProxy);

    await this.runtime.assertReady();
    const adapter = await this.requireGpu();
    const raw = await this.checkProxy(proxy, useTestProxy);
    const fingerprint = await this.generateFingerprint(raw, adapter);

    const now = new Date().toISOString();
    const id = this.store.newId();
    const profile: Profile = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      ...(useTestProxy ? { notes: 'Test proxy, not for real accounts.' } : {}),
      proxy: {
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        ...(proxy.username ? { username: proxy.username } : {}),
        ...(proxy.password ? { secretRef: PROXY_SECRET_REF } : {}),
        lastCheck: checkResult(raw, true),
      },
      fingerprint,
      runtime: {
        idleStopMinutes: this.config.defaultIdleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES,
        ...(useTestProxy ? { usesTestProxy: true } : {}),
        ...(opts.temporary ? { temporary: true } : {}),
      },
      status: {
        state: 'stopped',
        containerId: null,
        streamPort: null,
        lastError: null,
        lastStartedAt: null,
      },
    };
    await this.store.saveSecrets(id, proxy.password ? { proxyPassword: proxy.password } : {});
    await this.store.save(profile);
    await this.store.log(id, 'created', {
      name,
      proxy: describeProxy(proxy),
      exitIp: raw.exitIp,
      country: raw.country,
      timezone: raw.timezone,
      userAgent: fingerprint.userAgent,
    });
    return profile;
  }

  async update(id: string, req: UpdateProfileRequest): Promise<Profile> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      if (req.name !== undefined) profile.name = validName(req.name);
      if (req.notes !== undefined) profile.notes = String(req.notes).slice(0, 2000);
      if (req.idleStopMinutes !== undefined) {
        const minutes = Number(req.idleStopMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          throw new InputError('idleStopMinutes must be a whole number from 1 to 1440.');
        }
        profile.runtime.idleStopMinutes = minutes;
      }
      if (req.proxy !== undefined) {
        if (profile.status.state === 'running') {
          throw new AgentError('PROFILE_RUNNING', 'Stop the profile before changing its proxy.');
        }
        const proxy = parseProxy(req.proxy);
        await this.runtime.assertReady();
        const raw = await this.checkProxy(proxy, false);
        if (req.updateLocation && !locationMatches(profile.fingerprint, raw)) {
          await this.relocate(profile, raw);
        } else {
          assertLocationMatches(profile.fingerprint, raw);
          moveGeolocation(profile.fingerprint, raw);
        }
        profile.proxy = {
          type: proxy.type,
          host: proxy.host,
          port: proxy.port,
          ...(proxy.username ? { username: proxy.username } : {}),
          ...(proxy.password ? { secretRef: PROXY_SECRET_REF } : {}),
          lastCheck: checkResult(raw, true),
        };
        delete profile.runtime.usesTestProxy;
        const secrets = await this.store.getSecrets(id);
        if (proxy.password) secrets.proxyPassword = proxy.password;
        else delete secrets.proxyPassword;
        await this.store.saveSecrets(id, secrets);
        await this.store.log(id, 'proxy-changed', {
          proxy: describeProxy(proxy),
          exitIp: raw.exitIp,
        });
      }
      profile.updatedAt = new Date().toISOString();
      await this.store.save(profile);
      return profile;
    });
  }

  /**
   * "Update location" when the profile's own proxy now exits in another country (a start was
   * refused for that): the profile moves to where the proxy is. Nothing changes if it already
   * matches.
   */
  async updateLocation(id: string): Promise<Profile> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      if (profile.status.state === 'running' || profile.status.state === 'starting') {
        throw new AgentError('PROFILE_RUNNING', 'Stop the profile before updating its location.');
      }
      await this.runtime.assertReady();
      const proxy = proxyInput(profile, await this.store.getSecrets(id));
      const raw = await this.checkProxy(proxy, profile.runtime.usesTestProxy === true);
      if (!locationMatches(profile.fingerprint, raw)) await this.relocate(profile, raw);
      profile.proxy.lastCheck = checkResult(raw, true);
      profile.updatedAt = new Date().toISOString();
      await this.store.save(profile);
      return profile;
    });
  }

  /**
   * Moves a profile to the proxy's location (docs/06-proxies.md, specs/profile-schema.md): a
   * fingerprint is made for the new place on the same GPU, and only its location values are
   * taken (time zone, language with the Windows voices that go with it, geolocation, WebRTC
   * IP). Screen, fonts, hardware, WebGL, audio and the rest stay as they were.
   */
  private async relocate(profile: Profile, raw: RawProxyCheck): Promise<void> {
    const fp = profile.fingerprint;
    const before = { country: fp.locale.split('-')[1], timezone: fp.timezone, locale: fp.locale };
    const fresh = await this.generateFingerprint(raw, await this.requireSameGpu(fp));
    fp.timezone = fresh.timezone;
    fp.locale = fresh.locale;
    if (fresh.languages) fp.languages = fresh.languages;
    else delete fp.languages;
    if (fresh.geolocation) fp.geolocation = fresh.geolocation;
    else delete fp.geolocation;
    const config = fp.raw?.config;
    const prefs = fp.raw?.prefs;
    if (config && fresh.raw) {
      for (const key of LOCATION_CONFIG_KEYS) {
        if (key in fresh.raw.config) config[key] = fresh.raw.config[key];
        else delete config[key];
      }
    }
    if (prefs && fresh.raw) {
      for (const key of LOCATION_PREF_KEYS) {
        if (key in fresh.raw.prefs) prefs[key] = fresh.raw.prefs[key];
        else delete prefs[key];
      }
    }
    await this.store.log(profile.id, 'location-updated', {
      from: before,
      to: { country: raw.country, timezone: fp.timezone, locale: fp.locale },
    });
  }

  async delete(id: string, confirm: boolean): Promise<void> {
    if (!confirm)
      throw new InputError(
        "Deleting removes all of this profile's data. Send confirm=true to go ahead.",
      );
    await this.exclusive(id, async () => {
      await this.store.get(id);
      await this.runtime.stopAndRemove(containerName(id));
      await this.runtime.removeNetwork(networkName(id));
      await this.runtime.removeVolume(volumeName(id));
      await this.store.remove(id);
      this.forget(id);
    });
  }

  /**
   * Writes the profile to one encrypted file (profile-file.ts): its settings, its proxy
   * password and its browser data without caches. The profile must be stopped, so the browser
   * has saved everything. The app calls this directly; it is not in the HTTP API, which a
   * phone in Tailscale mode can reach.
   */
  async exportProfile(
    id: string,
    passphrase: string,
    file: string,
    options: { appVersion: string; onProgress?: (bytes: number) => void },
  ): Promise<{ bytes: number }> {
    checkPassphrase(passphrase);
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      const box = await this.runtime.inspect(containerName(id));
      if (box?.State?.Running) {
        throw new AgentError(
          'PROFILE_RUNNING',
          'Stop the profile before exporting it, so its browser saves everything first.',
        );
      }
      const secrets = await this.store.getSecrets(id);
      const manifest: ProfileFileManifest = {
        format: 1,
        exportedAt: new Date().toISOString(),
        appVersion: options.appVersion,
        profile: { ...profile, status: stoppedStatus() },
        secrets: secrets.proxyPassword ? { proxyPassword: secrets.proxyPassword } : {},
      };
      const partial = `${file}.part`;
      let read = 0;
      try {
        await this.runtime.withVolume(volumeName(id), true, async (c) => {
          const tar = (await c.getArchive({ path: '/data' })) as unknown as NodeJS.ReadableStream;
          const gzip = createGzip({ level: 6 });
          gzip.write(manifestBlock(manifest));
          await pipeline(
            tar,
            counter((n) => {
              read += n;
              options.onProgress?.(read);
            }),
            createTarFilter(keepOnExport),
            gzip,
            await createSealStream(passphrase),
            createWriteStream(partial),
          );
        });
        await rename(partial, file);
      } catch (err) {
        await rm(partial, { force: true });
        throw err;
      }
      const { size } = await stat(file);
      await this.store.log(id, 'exported', { bytes: size });
      return { bytes: size };
    });
  }

  /**
   * Makes a new profile from an exported file: same settings, fingerprint and browser data,
   * a new id. Refused when this PC already has the profile (two copies would be two devices
   * with one identity). `otherGpu` is set when the profile was made on a different graphics
   * card: it is imported, but won't start on this PC.
   */
  async importProfile(
    file: string,
    passphrase: string,
    options: { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<{ profile: Profile; otherGpu?: { madeOn: string; current: string | null } }> {
    checkPassphrase(passphrase);
    await this.runtime.assertReady();
    let total: number;
    try {
      total = (await stat(file)).size;
    } catch {
      throw new InputError("That file can't be found.");
    }
    let done = 0;
    const split = createManifestSplit();
    const tail = new PassThrough();
    const flowing = pipeline(
      createReadStream(file),
      counter((n) => {
        done += n;
        options.onProgress?.(done, total);
      }),
      createOpenStream(passphrase),
      createGunzip(),
      split.stream,
      createTarFilter(keepOnImport),
      tail,
    ).catch((err: unknown) => {
      tail.destroy();
      throw plainError(err);
    });
    flowing.catch(() => {});
    const stopFlowing = async () => {
      tail.destroy();
      await flowing.catch(() => {});
    };

    let imported: Profile;
    let manifest: ProfileFileManifest;
    try {
      // A wrong passphrase fails the stream before the manifest ever arrives.
      manifest = await Promise.race([split.manifest, flowing.then(() => split.manifest)]);
      imported = validImport(manifest);
    } catch (err) {
      await stopFlowing();
      throw plainError(err);
    }
    const same = (await this.list()).find(
      (p) => JSON.stringify(p.fingerprint) === JSON.stringify(imported.fingerprint),
    );
    if (same) {
      await stopFlowing();
      throw new AgentError(
        'PROFILE_EXISTS',
        `This PC already has this profile, as "${same.name}". Delete that one first to restore the copy.`,
        { id: same.id },
      );
    }

    const id = this.store.newId();
    const now = new Date().toISOString();
    const profile: Profile = { ...imported, id, updatedAt: now, status: stoppedStatus() };
    await this.runtime.ensureVolume(volumeName(id), id);
    try {
      await this.runtime.withVolume(volumeName(id), false, async (c) => {
        // A decryption error ends the upload early: report that error, not Docker's.
        const [up, flow] = await Promise.allSettled([c.putArchive(tail, { path: '/' }), flowing]);
        if (flow.status === 'rejected') throw flow.reason;
        if (up.status === 'rejected') throw up.reason;
      });
      await this.store.saveSecrets(
        id,
        manifest.secrets?.proxyPassword ? { proxyPassword: manifest.secrets.proxyPassword } : {},
      );
      await this.store.save(profile);
    } catch (err) {
      await stopFlowing();
      await this.runtime.removeVolume(volumeName(id));
      await this.store.remove(id).catch(() => {});
      throw err;
    }
    await this.store.log(id, 'imported', {
      name: profile.name,
      exportedAt: manifest.exportedAt,
      userAgent: profile.fingerprint.userAgent,
    });

    const madeOn = profile.fingerprint.webgl?.hostAdapter;
    const current = await detectGpu(this.config.gpu).catch(() => null);
    return typeof madeOn === 'string' && madeOn !== current
      ? { profile, otherGpu: { madeOn, current } }
      : { profile };
  }

  async checkProfileProxy(id: string): Promise<ProxyCheckResult> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      await this.runtime.assertReady();
      const proxy = proxyInput(profile, await this.store.getSecrets(id));
      const raw = await this.runProxyCheck(proxy);
      const verdict = judgeProxyCheck(raw, profile.runtime.usesTestProxy === true);
      profile.proxy.lastCheck = checkResult(raw, verdict.ok);
      await this.store.save(profile);
      await this.store.log(id, 'proxy-checked', {
        ok: verdict.ok,
        exitIp: raw.exitIp,
        country: raw.country,
      });
      return profile.proxy.lastCheck;
    });
  }

  // ---------------------------------------------------------------- proxy tester

  /**
   * Tests many proxies (testing/test-suite.md): either given outright, or "like" an
   * existing profile's proxy (its host and login) on a range of ports, so the password
   * never has to be typed again.
   */
  async startProxyTest(req: ProxyTestRequest): Promise<ProxyTestJob> {
    const proxies = [...(req.proxies ?? []).map((p) => parseProxy(p))];
    if (req.like) {
      const profile = await this.store.get(req.like.profileId);
      const base = proxyInput(profile, await this.store.getSecrets(profile.id));
      const [first, last] = req.like.ports;
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 1 ||
        last > 65535 ||
        first > last
      ) {
        throw new InputError('Give the ports as a range, for example 10001-10100.');
      }
      if (last - first >= 1000) throw new InputError('At most 1000 ports at once.');
      for (let port = first; port <= last; port++) proxies.push({ ...base, port });
    }
    if (!proxies.length) throw new InputError('No proxies to test.');
    const minutes = req.stickyMinutes ?? 5;
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 120) {
      throw new InputError('The sticky check waits 0 to 120 minutes.');
    }
    await this.runtime.assertReady();
    this.proxyTester ??= new ProxyTester(
      (p) => this.runProxyCheck(p),
      path.join(this.config.home, 'reports'),
      (p) => this.pixelscanProxy(p),
    );
    return this.proxyTester.start(proxies, {
      stickyMinutes: minutes,
      pixelscan: req.pixelscan === true,
    });
  }

  /**
   * Pixelscan's view of a proxy: a temporary profile on it (a fingerprint for its
   * location), an audit of Pixelscan alone, then the profile is deleted.
   */
  private async pixelscanProxy(proxy: ProxyInput): Promise<{ verdict: string; proxy: string }> {
    const temp = await this.create(
      { name: `proxy test ${proxy.host}:${proxy.port}`, proxy },
      { temporary: true },
    );
    try {
      const run = await this.audit(temp.id, ['pixelscan']);
      const value = (item: string) =>
        run.findings.find((f) => f.check === 'pixelscan' && f.item === item)?.value ??
        '(not found)';
      return { verdict: value('verdict'), proxy: value('proxy') };
    } finally {
      await this.delete(temp.id, true).catch(() => {});
    }
  }

  proxyTestJob(jobId: string): ProxyTestJob {
    const job = this.proxyTester?.get(jobId);
    if (!job) throw new InputError('No such proxy test.');
    return job;
  }

  // ---------------------------------------------------------------- audit

  /**
   * Runs check pages in a throwaway copy of the profile (testing/test-suite.md): the
   * same image, fingerprint and proxy, an in-memory /data, no published ports. The real
   * profile is never driven by automation and may be running meanwhile. Saves the
   * result and screenshots under <home>/reports/ and returns them.
   */
  async audit(
    id: string,
    checks: string[],
    options: { saveBaseline?: boolean } = {},
  ): Promise<AuditRun> {
    const profile = await this.store.get(id);
    await this.runtime.assertReady();
    const secrets = await this.store.getSecrets(id);
    const proxy = proxyInput(profile, secrets);
    const raw = await this.checkProxy(proxy, profile.runtime.usesTestProxy === true);
    assertLocationMatches(profile.fingerprint, raw);
    const gpu = gpuContainerSettings(await this.requireSameGpu(profile.fingerprint));

    const name = auditContainerName(id);
    await this.runtime.stopAndRemove(name, 1).catch(() => {});
    await this.runtime.ensureNetwork(networkName(id), id);
    const startedAt = new Date();
    await this.store.log(id, 'audit-started', { checks });
    try {
      const container = await this.runtime.docker.createContainer({
        name,
        Image: this.runtime.image,
        Labels: { [AUDIT_LABEL]: id },
        Env: [
          'ENCLAVE_AUDIT=1',
          'NEKO_MEMBER_PROVIDER=multiuser',
          `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${randomPassword()}`,
          `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${randomPassword()}`,
          ...gpu.env,
          ...exitEnv(raw),
        ],
        HostConfig: {
          NetworkMode: networkName(id),
          // A fresh browser profile each run, gone with the container.
          Tmpfs: { '/data': 'size=2g' },
          Mounts: [...gpu.mounts, ...this.locationMounts()],
          Devices: gpu.devices,
          CapAdd: ['NET_ADMIN'],
          SecurityOpt: ['no-new-privileges'],
          ShmSize: SHM_BYTES,
          Memory: CONTAINER_MEMORY_BYTES,
          ExtraHosts: ['host.docker.internal:host-gateway'],
        },
      });
      await container.putArchive(
        makeTar([
          ...configFiles(profile, proxy),
          { name: 'config/audit.json', mode: 0o644, content: JSON.stringify({ checks }) },
        ]),
        { path: '/' },
      );
      await container.start();

      const report = await this.waitForAuditResult(name);
      const dir = path.join(
        this.config.home,
        'reports',
        `${startedAt.toISOString().replace(/[:.]/g, '-')}-audit-${slug(profile.name)}`,
      );
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
      for (const check of report.checks ?? []) {
        if (!check.screenshot || !/^[\w.-]+\.png$/.test(check.screenshot)) continue;
        const shot = await this.runtime.execOutput(
          name,
          ['base64', '-w0', `/data/audit/${check.screenshot}`],
          'root',
        );
        if (shot.code === 0) {
          await writeFile(path.join(dir, check.screenshot), Buffer.from(shot.stdout, 'base64'));
        }
      }
      const baselineFile = path.join(
        this.config.home,
        'profiles',
        id,
        'baselines',
        'baseline.json',
      );
      const findings = evaluateAudit(report, {
        exitIp: raw.exitIp ?? null,
        baseline: await readJson(baselineFile),
        reference: await this.loadReference(),
      });
      // The audit's probe is what a normal start shows (same image, same launch
      // settings), so it can stand in for scripts/fingerprint/baseline.mjs without
      // opening anything in the real profile.
      const probe = report.checks?.find((c) => c.name === 'probe' && c.status === 'ok');
      if (options.saveBaseline && probe?.data) {
        await mkdir(path.dirname(baselineFile), { recursive: true });
        await writeFile(baselineFile, JSON.stringify(probe.data, null, 2));
        await this.store.log(id, 'baseline-saved', { from: dir });
      }
      const summary = summarize(profile.name, raw.exitIp ?? null, findings);
      await writeFile(path.join(dir, 'findings.json'), JSON.stringify(findings, null, 2));
      await writeFile(path.join(dir, 'summary.txt'), `${summary}\n`);
      await this.store.log(id, 'audit-finished', {
        reportDir: dir,
        fail: findings.filter((f) => f.verdict === 'fail').length,
      });
      return { reportDir: dir, exitIp: raw.exitIp ?? null, report, findings, summary };
    } finally {
      await this.runtime.stopAndRemove(name, 2).catch(() => {});
    }
  }

  /**
   * Starts an audit in the background; an audit takes minutes, longer than an HTTP
   * request should wait. Poll auditJob() for the outcome. One audit per profile at once.
   */
  startAudit(id: string, checks: string[], options: { saveBaseline?: boolean } = {}): AuditJob {
    const running = [...this.auditJobs.values()].find(
      (j) => j.profileId === id && j.state === 'running',
    );
    if (running) return running;
    const job: AuditJob = {
      id: randomBytes(8).toString('hex'),
      profileId: id,
      checks,
      state: 'running',
      startedAt: new Date().toISOString(),
    };
    this.auditJobs.set(job.id, job);
    this.audit(id, checks, options).then(
      (run) => Object.assign(job, { state: 'done', finishedAt: new Date().toISOString(), run }),
      (e: unknown) =>
        Object.assign(job, {
          state: 'failed',
          finishedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        }),
    );
    return job;
  }

  auditJob(jobId: string): AuditJob {
    const job = this.auditJobs.get(jobId);
    if (!job) throw new InputError('No such audit.');
    return job;
  }

  private async loadReference(): Promise<Reference> {
    const dir = this.config.referenceDir;
    return {
      probe: await readJson(path.join(dir, 'probe.json')),
      metrics: await readJson(path.join(dir, 'metrics.json')),
      svgEmojiCurrentFont: await readJson(path.join(dir, 'svg-emoji-current-font.json')),
      creepjs: await readJson(path.join(dir, 'creepjs.json')),
    };
  }

  private async waitForAuditResult(name: string): Promise<AuditReport> {
    const deadline = Date.now() + AUDIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await this.runtime.inspect(name);
      if (!info?.State.Running) {
        const logs = await this.runtime.logsTail(name, 20);
        throw new AgentError(
          'INTERNAL',
          `The audit container stopped early: ${logs.trim().slice(-500)}`,
        );
      }
      const out = await this.runtime
        .execOutput(name, ['cat', '/data/audit/result.json'], 'root')
        .catch(() => null);
      if (out?.code === 0 && out.stdout.trim()) return JSON.parse(out.stdout) as AuditReport;
      await new Promise((r) => setTimeout(r, AUDIT_POLL_MS));
    }
    throw new AgentError('INTERNAL', 'The audit took longer than 20 minutes and was stopped.');
  }

  // ---------------------------------------------------------------- start / stop

  async start(id: string): Promise<{ stream: StreamInfo }> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      await this.runtime.assertReady();
      const name = containerName(id);
      const existing = await this.runtime.inspect(name);
      if (existing?.State.Running) {
        throw new AgentError('PROFILE_RUNNING', `"${profile.name}" is already running.`);
      }
      if (existing) await this.runtime.stopAndRemove(name);

      await this.setStatus(profile, { state: 'starting', lastError: null });
      await this.store.log(id, 'starting');
      let relayed: number | null = null;
      try {
        const secrets = await this.store.getSecrets(id);
        const proxy = proxyInput(profile, secrets);
        const raw = await this.checkProxy(proxy, profile.runtime.usesTestProxy === true);
        assertLocationMatches(profile.fingerprint, raw);
        profile.proxy.lastCheck = checkResult(raw, true);
        const gpu = gpuContainerSettings(await this.requireSameGpu(profile.fingerprint));

        const [webPort, muxPort] = await this.allocatePorts();
        // Phone mode: the stream is also relayed to the tailnet. Without Tailscale the
        // profile still starts for the PC; the phone link is simply missing.
        const tailnet = this.phone ? await this.phone.address() : null;
        if (this.phone && !tailnet) await this.store.log(id, 'phone-unavailable');
        // Relay mode: the phone's stream may need the relay's TURN server. Without the link
        // the profile still starts for the PC; a phone can use it after a restart.
        const turn = this.relayTurn ? this.relayTurn() : null;
        if (this.relayTurn && !turn) await this.store.log(id, 'phone-unavailable');
        const stream = {
          userPassword: randomPassword(),
          adminPassword: randomPassword(),
          expiresAt: new Date(Date.now() + STREAM_TTL_MS).toISOString(),
          ...(tailnet ? { phoneHost: tailnet.host } : {}),
          ...(turn ? { viaRelay: true } : {}),
        };
        await this.store.saveSecrets(id, { ...secrets, stream });

        await this.runtime.ensureNetwork(networkName(id), id);
        await this.runtime.ensureVolume(volumeName(id), id);
        const container = await this.runtime.docker.createContainer({
          name,
          Image: this.runtime.image,
          Labels: { [PROFILE_LABEL]: id },
          Env: [
            'NEKO_MEMBER_PROVIDER=multiuser',
            `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${stream.userPassword}`,
            `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${stream.adminPassword}`,
            `NEKO_WEBRTC_TCPMUX=${muxPort}`,
            `NEKO_WEBRTC_UDPMUX=${muxPort}`,
            ...(turn ? relayStreamEnv(turn) : ['NEKO_WEBRTC_ICELITE=true']),
            // The address WebRTC tells viewers to reach the mux port at. One only: with two,
            // pion keeps the first ("overlapping address rewrite rule"). In phone mode that is
            // the PC's Tailscale IP, which tailscale serve relays and the PC reaches too.
            `NEKO_WEBRTC_NAT1TO1=${tailnet ? tailnet.ip : '127.0.0.1'}`,
            // Who may talk to neko: the PC's own page, the Windows app's viewer and, in phone
            // mode, the phone app (served by the agent from its own origin).
            `NEKO_SERVER_CORS=${[
              `http://127.0.0.1:${webPort}`,
              DESKTOP_APP_ORIGIN,
              ...(tailnet ? [phoneAppOrigin(tailnet, this.config.port)] : []),
            ].join(' ')}`,
            ...gpu.env,
            ...exitEnv(raw),
          ],
          ExposedPorts: { '8080/tcp': {}, [`${muxPort}/tcp`]: {}, [`${muxPort}/udp`]: {} },
          HostConfig: {
            NetworkMode: networkName(id),
            PortBindings: {
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(webPort) }],
              [`${muxPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(muxPort) }],
              [`${muxPort}/udp`]: [{ HostIp: '127.0.0.1', HostPort: String(muxPort) }],
            },
            Mounts: [
              { Type: 'volume', Source: volumeName(id), Target: '/data' },
              ...gpu.mounts,
              ...this.locationMounts(),
            ],
            Devices: gpu.devices,
            // The egress lock needs NET_ADMIN once; the entrypoint drops it before the browser starts.
            CapAdd: ['NET_ADMIN'],
            SecurityOpt: ['no-new-privileges'],
            ShmSize: SHM_BYTES,
            Memory: CONTAINER_MEMORY_BYTES,
            ExtraHosts: ['host.docker.internal:host-gateway'],
          },
        });
        await container.putArchive(configArchive(profile, proxy), { path: '/' });
        await container.start();
        await this.waitUntilReady(name, webPort);
        if (tailnet && this.phone) {
          relayed = webPort;
          await this.phone.serveHttps(webPort);
          await this.phone.serveTcp(muxPort);
        }

        profile.status = {
          state: 'running',
          containerId: container.id,
          streamPort: webPort,
          lastError: null,
          lastStartedAt: new Date().toISOString(),
        };
        await this.store.save(profile);
        this.lastViewerAt.set(id, Date.now());
        this.nekoTokens.delete(id);
        await this.store.log(id, 'started', {
          webPort,
          muxPort,
          exitIp: raw.exitIp,
          phone: tailnet ? 'tailscale' : turn ? 'relay' : false,
        });
        return { stream: streamInfo(webPort, stream) };
      } catch (e) {
        await this.runtime.stopAndRemove(name, 5).catch(() => {});
        await this.stopRelays(relayed);
        const message = e instanceof Error ? e.message : String(e);
        const proxyProblem = e instanceof AgentError && e.code.startsWith('PROXY_');
        await this.setStatus(profile, {
          state: proxyProblem || e instanceof AgentError ? 'stopped' : 'error',
          containerId: null,
          streamPort: null,
          lastError: message,
        });
        await this.store.log(id, 'start-failed', {
          code: e instanceof AgentError ? e.code : 'INTERNAL',
          message,
        });
        throw e instanceof AgentError || e instanceof InputError
          ? e
          : new AgentError('INTERNAL', `"${profile.name}" didn't start: ${message}`);
      }
    });
  }

  async stop(id: string, reason: 'requested' | 'idle' = 'requested'): Promise<void> {
    await this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      const info = await this.runtime.inspect(containerName(id));
      if (!info?.State.Running && profile.status.state !== 'running') {
        throw new AgentError('PROFILE_NOT_RUNNING', `"${profile.name}" isn't running.`);
      }
      await this.runtime.stopAndRemove(containerName(id));
      await this.runtime.removeNetwork(networkName(id));
      await this.stopRelays(profile.status.streamPort);
      const secrets = await this.store.getSecrets(id);
      delete secrets.stream;
      await this.store.saveSecrets(id, secrets);
      await this.setStatus(profile, {
        state: 'stopped',
        containerId: null,
        streamPort: null,
        lastError: null,
      });
      this.forget(id);
      await this.store.log(id, 'stopped', { reason });
    });
  }

  // ---------------------------------------------------------------- background work

  /** Brings stored status in line with Docker (after an agent or PC restart), then watches. */
  async startMonitor(): Promise<void> {
    if (await this.runtime.ping()) {
      for (const profile of await this.store.list()) {
        if (profile.status.state !== 'running' && profile.status.state !== 'starting') continue;
        const info = await this.runtime.inspect(containerName(profile.id));
        if (info?.State.Running && profile.status.state === 'running') {
          this.lastViewerAt.set(profile.id, Date.now());
        } else {
          await this.runtime.stopAndRemove(containerName(profile.id), 5);
          await this.stopRelays(profile.status.streamPort);
          await this.setStatus(profile, { state: 'stopped', containerId: null, streamPort: null });
          await this.store.log(profile.id, 'reconciled', { was: profile.status.state });
        }
      }
      // A proxy test's temporary profile left behind by a crash or a closed app.
      for (const profile of await this.store.list()) {
        if (profile.runtime.temporary) await this.delete(profile.id, true).catch(() => {});
      }
    }
    this.monitor = setInterval(() => void this.tick(), MONITOR_INTERVAL_MS);
    this.monitor.unref();
  }

  stopMonitor(): void {
    if (this.monitor) clearInterval(this.monitor);
  }

  private async tick(): Promise<void> {
    let profiles: Profile[];
    try {
      profiles = await this.store.list();
    } catch {
      return;
    }
    for (const profile of profiles.filter((p) => p.status.state === 'running')) {
      if (this.locks.has(profile.id)) continue;
      await this.watch(profile).catch(() => {});
    }
  }

  private async watch(profile: Profile): Promise<void> {
    const id = profile.id;
    const name = containerName(id);
    const info = await this.runtime.inspect(name);
    if (!info?.State.Running) {
      await this.setStatus(profile, {
        state: 'error',
        containerId: null,
        streamPort: null,
        lastError: 'The browser stopped unexpectedly.',
      });
      await this.stopRelays(profile.status.streamPort);
      await this.store.log(id, 'exited', { exitCode: info?.State.ExitCode ?? null });
      this.forget(id);
      return;
    }

    // Idle stop: nobody connected to the stream for idleStopMinutes.
    const viewers = await this.countViewers(profile);
    const now = Date.now();
    if (viewers === null || viewers > 0 || !this.lastViewerAt.has(id))
      this.lastViewerAt.set(id, now);
    const idleMinutes = profile.runtime.idleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES;
    if (now - this.lastViewerAt.get(id)! >= idleMinutes * 60_000) {
      await this.stop(id, 'idle');
      return;
    }

    // Proxy health, through the profile's own forwarder (the lock blocks everything else).
    const code = await this.runtime
      .exec(
        name,
        [
          'curl',
          '-s',
          '-o',
          '/dev/null',
          '-m',
          '15',
          '--socks5-hostname',
          '127.0.0.1:1080',
          'https://api.ipify.org',
        ],
        'neko',
      )
      .catch(() => -1);
    const healthy = code === 0;
    if (!healthy && profile.status.lastError !== PROXY_UNREACHABLE) {
      await this.setStatus(profile, { lastError: PROXY_UNREACHABLE });
      await this.store.log(id, 'proxy-unreachable');
    } else if (healthy && profile.status.lastError === PROXY_UNREACHABLE) {
      await this.setStatus(profile, { lastError: null });
      await this.store.log(id, 'proxy-back');
    }
  }

  /** Viewers connected to the stream, or null if neko couldn't be asked. */
  private async countViewers(profile: Profile): Promise<number | null> {
    const port = profile.status.streamPort;
    const secrets = await this.store.getSecrets(profile.id);
    if (!port || !secrets.stream) return null;
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let token = this.nekoTokens.get(profile.id);
        if (!token) {
          token = await nekoLogin(base, 'enclave-agent', secrets.stream.adminPassword);
          this.nekoTokens.set(profile.id, token);
        }
        const sessions = await nekoSessions(base, token);
        return sessions.filter((s) => s.state?.is_connected).length;
      } catch {
        this.nekoTokens.delete(profile.id);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- helpers

  /** Runs the safety check and throws the matching API error if it fails. */
  private async checkProxy(proxy: ProxyInput, allowRealIp: boolean): Promise<RawProxyCheck> {
    const raw = await this.runProxyCheck(proxy);
    const verdict = judgeProxyCheck(raw, allowRealIp);
    if (!verdict.ok) {
      throw new AgentError(verdict.code, verdict.message, {
        proxy: describeProxy(proxy),
        ...(raw.exitIp ? { exitIp: raw.exitIp } : {}),
      });
    }
    return raw;
  }

  private async runProxyCheck(proxy: ProxyInput): Promise<RawProxyCheck> {
    const out = await this.runtime.runOneOff({
      cmd: ['bash', '-c', '/opt/enclave/check_proxy.py < /run/check/proxy.json'],
      mounts: this.locationMounts(),
      files: [
        { name: 'run/check/', mode: 0o700 },
        { name: 'run/check/proxy.json', mode: 0o600, content: JSON.stringify(proxy) },
      ],
      timeoutMs: 90_000,
    });
    return JSON.parse(out) as RawProxyCheck;
  }

  /**
   * The PC's GPU, which profiles render on and claim. Refuses when there is none, or when
   * Docker can't hand it to containers: a profile drawing in software would show output
   * no Windows PC produces.
   */
  private async requireGpu(): Promise<string> {
    const adapter = await detectGpu(this.config.gpu).catch(() => null);
    if (!adapter) {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        this.config.gpu
          ? `No graphics card matching "${this.config.gpu}" (ENCLAVE_GPU). Check the name in Device Manager.`
          : "This PC's graphics card couldn't be found. Profiles need it to draw like a real Windows PC.",
      );
    }
    const gpu = gpuContainerSettings(adapter);
    try {
      await this.runtime.runOneOff({
        cmd: ['test', '-c', '/dev/dxg'],
        networkMode: 'none',
        devices: gpu.devices,
        mounts: gpu.mounts,
        timeoutMs: 60_000,
      });
    } catch {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        `Docker can't give profiles the graphics card (${adapter}). Update Windows, WSL and the graphics driver, then try again.`,
      );
    }
    return adapter;
  }

  /** A profile claims the GPU it was made on; starting it on another would contradict that. */
  private async requireSameGpu(fingerprint: Fingerprint): Promise<string> {
    const madeOn = fingerprint.webgl?.hostAdapter;
    if (typeof madeOn !== 'string') {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        'This profile was made before profiles used the graphics card. Create a new profile.',
      );
    }
    const adapter = await this.requireGpu();
    if (adapter !== madeOn) {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        `This profile was made on a PC with ${madeOn}, but this one has ${adapter}. It can't start here without changing its fingerprint.`,
        { madeOn, current: adapter },
      );
    }
    return adapter;
  }

  private async generateFingerprint(raw: RawProxyCheck, adapter: string): Promise<Fingerprint> {
    const out = await this.runtime.runOneOff({
      cmd: [
        '/opt/enclave/gen_fingerprint.py',
        '--gpu',
        adapter,
        '--country',
        raw.country!,
        '--timezone',
        raw.timezone!,
        '--locale',
        raw.locale ?? `en-${raw.country}`,
        '--ip',
        raw.exitIp!,
      ],
      networkMode: 'none',
      mounts: this.locationMounts(),
      timeoutMs: 120_000,
    });
    return JSON.parse(out) as Fingerprint;
  }

  private async allocatePorts(): Promise<[number, number]> {
    const used = await this.runtime.usedHostPorts();
    for (const p of await this.store.list()) if (p.status.streamPort) used.add(p.status.streamPort);
    for (let web = PORT_RANGE.first; web < PORT_RANGE.last; web += 2) {
      const mux = web + 1;
      if (used.has(web) || used.has(mux)) continue;
      if ((await portFree(web)) && (await portFree(mux))) return [web, mux];
    }
    throw new AgentError(
      'INTERNAL',
      'No free stream ports left. Stop another profile and try again.',
    );
  }

  private async waitUntilReady(name: string, webPort: number): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await this.runtime.inspect(name);
      if (!info?.State.Running) {
        const tail = (await this.runtime.logsTail(name, 40))
          .split('\n')
          .filter((l) => l.includes('enclave:'))
          .join(' ');
        throw new Error(
          tail || `the browser stopped during startup (code ${info?.State.ExitCode ?? '?'})`,
        );
      }
      if (
        info.State.Health?.Status === 'healthy' &&
        (await nekoReachable(`http://127.0.0.1:${webPort}`))
      )
        return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`the browser wasn't ready after ${START_TIMEOUT_MS / 1000} s`);
  }

  /** Removes a profile's tailnet relays (web port, and the mux port right after it). */
  private async stopRelays(webPort: number | null): Promise<void> {
    if (!this.phone || !webPort) return;
    await this.phone.stopHttps(webPort);
    await this.phone.stopTcp(webPort + 1);
  }

  private async setStatus(profile: Profile, patch: Partial<ProfileStatus>): Promise<void> {
    profile.status = { ...profile.status, ...patch };
    await this.store.save(profile);
  }

  private forget(id: string): void {
    this.lastViewerAt.delete(id);
    this.nekoTokens.delete(id);
  }

  /** One state change at a time per profile. */
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }
}

function stoppedStatus(): ProfileStatus {
  return {
    state: 'stopped',
    containerId: null,
    streamPort: null,
    lastError: null,
    lastStartedAt: null,
  };
}

/** Counts the bytes going through. */
function counter(onBytes: (n: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      onBytes(chunk.length);
      done(null, chunk);
    },
  });
}

/** Errors from inside a profile file's streams: ours pass, the rest read as damage. */
function plainError(err: unknown): Error {
  if (err instanceof AgentError || err instanceof InputError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return new InputError("That file can't be found.");
  if (
    (typeof code === 'string' && code.startsWith('Z_')) ||
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    /^tar:/.test((err as Error)?.message ?? '')
  ) {
    return new AgentError(
      'BAD_PROFILE_FILE',
      'This profile file is damaged or incomplete. Export the profile again.',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** The profile inside an exported file, checked before anything is written. */
function validImport(manifest: ProfileFileManifest): Profile {
  const bad = (what: string) =>
    new AgentError('BAD_PROFILE_FILE', `This profile file can't be imported: ${what}.`);
  if (manifest?.format !== 1) throw bad('its format is unknown');
  const p = manifest.profile;
  if (!p || typeof p !== 'object') throw bad('it holds no profile');
  validName(p.name);
  if (!p.fingerprint || typeof p.fingerprint !== 'object' || !p.fingerprint.userAgent) {
    throw bad('its device fingerprint is missing');
  }
  const proxy = p.proxy;
  if (
    !proxy ||
    typeof proxy.type !== 'string' ||
    typeof proxy.host !== 'string' ||
    !Number.isInteger(proxy.port)
  ) {
    throw bad('its proxy is missing');
  }
  return p;
}

function validName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text || text.length > 60)
    throw new InputError('The profile name must be 1 to 60 characters.');
  return text;
}

function proxyInput(profile: Profile, secrets: ProfileSecrets): ProxyInput {
  const { type, host, port, username } = profile.proxy;
  return {
    type,
    host,
    port,
    ...(username ? { username } : {}),
    ...(secrets.proxyPassword ? { password: secrets.proxyPassword } : {}),
  };
}

function checkResult(raw: RawProxyCheck, ok: boolean): ProxyCheckResult {
  return {
    at: new Date().toISOString(),
    ok,
    ...(raw.exitIp ? { exitIp: raw.exitIp } : {}),
    ...(raw.country ? { country: raw.country } : {}),
    ...(raw.timezone ? { timezone: raw.timezone } : {}),
    ...(raw.latencyMs !== undefined ? { latencyMs: raw.latencyMs } : {}),
  };
}

/**
 * The fingerprint values that follow the profile's location ("Update location"): Camoufox's
 * config keys for time zone, language, geolocation, the WebRTC IP, and the Windows speech
 * voices (a PC's voices come with its language); and Firefox's requested locale.
 */
const LOCATION_CONFIG_KEYS = [
  'timezone',
  'locale:language',
  'locale:region',
  'locale:script',
  'geolocation:latitude',
  'geolocation:longitude',
  'geolocation:accuracy',
  'webrtc:ipv4',
  'voices',
  'voices:blockIfNotDefined',
];
const LOCATION_PREF_KEYS = ['intl.locale.requested'];

function locationMatches(fingerprint: Fingerprint, raw: RawProxyCheck): boolean {
  const country = fingerprint.locale.split('-')[1]?.toUpperCase();
  return raw.timezone === fingerprint.timezone && (!country || raw.country === country);
}

/** Hard rule 3: the proxy's location must still match the saved fingerprint. */
function assertLocationMatches(fingerprint: Fingerprint, raw: RawProxyCheck): void {
  const country = fingerprint.locale.split('-')[1]?.toUpperCase();
  if (locationMatches(fingerprint, raw)) return;
  throw new AgentError(
    'PROXY_LOCATION_MISMATCH',
    `The proxy is now in ${raw.country} (${raw.timezone}), but this profile was made for ${country ?? '?'} (${fingerprint.timezone}). Not starting, to keep the profile consistent.`,
    {
      expected: { country, timezone: fingerprint.timezone },
      actual: { country: raw.country, timezone: raw.timezone, exitIp: raw.exitIp },
    },
  );
}

/**
 * The address WebRTC reports as the profile's public IP: the exit IP this start's check
 * just saw, not the one saved at creation, so it stays equal to the IP websites see
 * after a proxy change or a new sticky IP. Likewise the browser's location: where that
 * IP is now (same country and timezone, checked before), in case a sticky IP was renewed
 * elsewhere.
 */
function exitEnv(raw: RawProxyCheck): string[] {
  return [
    ...(raw.exitIp ? [`ENCLAVE_EXIT_IP=${raw.exitIp}`] : []),
    ...(raw.lat !== undefined && raw.lon !== undefined
      ? [`ENCLAVE_EXIT_LAT=${raw.lat}`, `ENCLAVE_EXIT_LON=${raw.lon}`]
      : []),
  ];
}

/**
 * A new proxy in the same country and timezone can exit in another city. The browser's
 * location follows it (hard rule 3), as "Update location" allows; nothing else changes.
 */
function moveGeolocation(fingerprint: Fingerprint, raw: RawProxyCheck): void {
  if (raw.lat === undefined || raw.lon === undefined || !fingerprint.geolocation) return;
  fingerprint.geolocation = { ...fingerprint.geolocation, lat: raw.lat, lon: raw.lon };
  const config = fingerprint.raw?.config as Record<string, unknown> | undefined;
  if (config && 'geolocation:latitude' in config) {
    config['geolocation:latitude'] = raw.lat;
    config['geolocation:longitude'] = raw.lon;
  }
}

function streamInfo(port: number, stream: NonNullable<ProfileSecrets['stream']>): StreamInfo {
  return {
    url: `http://127.0.0.1:${port}/`,
    ...(stream.phoneHost ? { phoneUrl: `https://${stream.phoneHost}:${port}/` } : {}),
    phone: !!stream.phoneHost || stream.viaRelay === true,
    password: stream.userPassword,
    expiresAt: stream.expiresAt,
  };
}

/**
 * Relay mode (Stage 6): neko gathers candidates for the phone too (no ICE lite), with the
 * relay's STUN and TURN server by IP (the container has no DNS). The egress lock opens UDP
 * and that TURN server to neko's own group only (apply_egress_lock.sh): the browser still
 * reaches nothing but its proxy. Viewers get no ICE servers from neko: the phone app brings
 * its own from the relay, and the PC's viewer needs none.
 */
export function relayStreamEnv(turn: PcTurn): string[] {
  const at = `${turn.ip}:${turn.port}`;
  const servers = [
    { urls: [`stun:${at}`] },
    {
      urls: [`turn:${at}?transport=udp`, `turn:${at}?transport=tcp`],
      username: turn.username,
      credential: turn.credential,
    },
  ];
  return [
    'NEKO_WEBRTC_ICELITE=false',
    `NEKO_WEBRTC_ICESERVERS_BACKEND=${JSON.stringify(servers)}`,
    'NEKO_WEBRTC_ICESERVERS_FRONTEND=[]',
    `ENCLAVE_STREAM_TURN=${at}`,
  ];
}

/** Where the phone app is served: the agent's port, relayed to the tailnet over HTTPS. */
export function phoneAppOrigin(tailnet: TailnetAddress, agentPort: number): string {
  return `https://${tailnet.host}:${agentPort}`;
}

/** /config for the container (images/browser/README.md). proxy.json holds the password: root-only. */
/** A JSON file's content, or undefined when it is missing or unreadable. */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profile'
  );
}

function configFiles(profile: Profile, proxy: ProxyInput): TarEntry[] {
  return [
    { name: 'config/', mode: 0o755 },
    { name: 'config/profile.json', mode: 0o644, content: JSON.stringify(profile) },
    { name: 'config/proxy.json', mode: 0o600, content: JSON.stringify(proxy) },
  ];
}

function configArchive(profile: Profile, proxy: ProxyInput): Buffer {
  return makeTar(configFiles(profile, proxy));
}

/** One check page's outcome, as audit.py records it. */
export interface AuditCheckResult {
  name: string;
  url: string;
  status: 'ok' | 'error';
  error?: string;
  /** Our own pages: their JSON. */
  data?: unknown;
  /** Third-party pages: the page text. */
  text?: string;
  screenshot?: string;
  /** Facts read from markup (e.g. CreepJS's lie marks). */
  extra?: unknown;
  seconds: number;
}

export interface AuditReport {
  startedAt: string;
  finishedAt: string;
  checks: AuditCheckResult[];
  error?: string;
}

export interface AuditJob {
  id: string;
  profileId: string;
  checks: string[];
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  run?: AuditRun;
  error?: string;
}

export interface AuditRun {
  reportDir: string;
  exitIp: string | null;
  report: AuditReport;
  findings: Finding[];
  summary: string;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

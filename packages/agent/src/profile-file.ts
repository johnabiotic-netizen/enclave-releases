// An exported profile: one encrypted file (.enclave) holding the profile's settings, its proxy
// password and its browser data, for a backup or a move to another PC. specs/profile-file.md.
//
// File:      "ENCLAVE-PROFILE\n" | header length (uint32 BE) | header (JSON) | records
// Record:    final flag (1 byte) | length (uint32 BE) | AES-256-GCM ciphertext and tag
// Plaintext: gzip of [ manifest length (uint32 BE) | manifest (JSON) | tar of /data ]
//
// The key comes from the passphrase through scrypt (salt and costs in the header). Every record
// authenticates the whole header and its own final flag, and nonces count up, so a changed
// header, records swapped or dropped, or a file cut short all fail to open.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { Profile } from '@enclave/shared';
import { AgentError, InputError } from './errors.js';

export const PROFILE_FILE_EXTENSION = 'enclave';
const MAGIC = Buffer.from('ENCLAVE-PROFILE\n', 'ascii');
const FORMAT = 1;
const CHUNK = 1024 * 1024;
const TAG = 16;
const MAX_HEADER = 4096;
const MAX_MANIFEST = 1024 * 1024;
export const MIN_PASSPHRASE = 10;

/** scrypt costs: 128 MB of memory and about half a second per try on a normal PC. */
const KDF = { N: 2 ** 17, r: 8, p: 1 };

export interface ProfileFileManifest {
  format: typeof FORMAT;
  exportedAt: string;
  appVersion: string;
  /** The profile as saved, with its status reset. Its id is replaced on import. */
  profile: Profile;
  secrets: { proxyPassword?: string };
}

interface FileHeader {
  format: number;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'aes-256-gcm';
  noncePrefix: string;
  chunk: number;
}

export function checkPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE) {
    throw new InputError(`Use a passphrase of ${MIN_PASSPHRASE} characters or more.`);
  }
  return passphrase;
}

function deriveKey(passphrase: string, kdf: FileHeader['kdf']): Promise<Buffer> {
  const options: ScryptOptions = {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * kdf.N * kdf.r + 1024 * 1024,
  };
  return new Promise((resolve, reject) =>
    scryptCb(
      passphrase.normalize('NFC'),
      Buffer.from(kdf.salt, 'base64'),
      32,
      options,
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

function nonce(prefix: Buffer, counter: number): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 8);
  n.writeUInt32BE(counter, 8);
  return n;
}

/** The plaintext's first bytes: the manifest, length first. */
export function manifestBlock(manifest: ProfileFileManifest): Buffer {
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([len, json]);
}

/** Encrypts a plaintext stream into the file format. */
export async function createSealStream(passphrase: string): Promise<Transform> {
  const header: FileHeader = {
    format: FORMAT,
    kdf: { name: 'scrypt', ...KDF, salt: randomBytes(16).toString('base64') },
    cipher: 'aes-256-gcm',
    noncePrefix: randomBytes(8).toString('base64'),
    chunk: CHUNK,
  };
  const key = await deriveKey(passphrase, header.kdf);
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.from(header.noncePrefix, 'base64');
  let counter = 0;
  let pending: Buffer[] = [];
  let pendingSize = 0;
  let started = false;

  const record = (plain: Buffer, final: boolean): Buffer => {
    const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, counter++));
    cipher.setAAD(Buffer.concat([headerBytes, Buffer.from([final ? 1 : 0])]));
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const head = Buffer.alloc(5);
    head[0] = final ? 1 : 0;
    head.writeUInt32BE(body.length, 1);
    return Buffer.concat([head, body]);
  };
  const start = (stream: Transform) => {
    if (started) return;
    started = true;
    const len = Buffer.alloc(4);
    len.writeUInt32BE(headerBytes.length);
    stream.push(Buffer.concat([MAGIC, len, headerBytes]));
  };

  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      start(this);
      pending.push(chunk);
      pendingSize += chunk.length;
      // Keep up to one chunk back: only the last record is marked final.
      if (pendingSize > CHUNK) {
        let all = Buffer.concat(pending);
        while (all.length > CHUNK) {
          this.push(record(all.subarray(0, CHUNK), false));
          all = all.subarray(CHUNK);
        }
        pending = [all];
        pendingSize = all.length;
      }
      done();
    },
    flush(done) {
      start(this);
      this.push(record(Buffer.concat(pending), true));
      done();
    },
  });
}

/** Decrypts the file format. Errors are AgentErrors with a message for the person. */
export function createOpenStream(passphrase: string): Transform {
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let headerBytes: Buffer | null = null;
  let prefix: Buffer | null = null;
  let key: Buffer | null = null;
  let counter = 0;
  let finished = false;

  const notOurs = () =>
    new AgentError('BAD_PROFILE_FILE', "This isn't an Enclave profile file, or it's damaged.");
  const damaged = () =>
    new AgentError(
      'BAD_PROFILE_FILE',
      'This profile file is damaged or incomplete. Export the profile again.',
    );

  async function step(stream: Transform): Promise<void> {
    if (!headerBytes) {
      if (buf.length < MAGIC.length + 4) return;
      if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw notOurs();
      const len = buf.readUInt32BE(MAGIC.length);
      if (len > MAX_HEADER) throw notOurs();
      if (buf.length < MAGIC.length + 4 + len) return;
      const bytes = buf.subarray(MAGIC.length + 4, MAGIC.length + 4 + len);
      let header: FileHeader;
      try {
        header = JSON.parse(bytes.toString('utf8')) as FileHeader;
      } catch {
        throw notOurs();
      }
      if (header.format !== FORMAT) {
        throw new AgentError(
          'BAD_PROFILE_FILE',
          'This profile file was made by a newer Enclave. Update Enclave, then import it.',
        );
      }
      const k = header.kdf;
      if (
        header.cipher !== 'aes-256-gcm' ||
        k?.name !== 'scrypt' ||
        ![2 ** 14, 2 ** 15, 2 ** 16, 2 ** 17, 2 ** 18].includes(k.N) ||
        k.r !== 8 ||
        k.p !== 1 ||
        header.chunk !== CHUNK
      ) {
        throw notOurs();
      }
      prefix = Buffer.from(header.noncePrefix, 'base64');
      if (prefix.length !== 8) throw notOurs();
      key = await deriveKey(passphrase, k);
      headerBytes = Buffer.from(bytes);
      buf = buf.subarray(MAGIC.length + 4 + len);
    }
    for (;;) {
      if (buf.length === 0) return;
      if (finished) throw damaged();
      if (buf.length < 5) return;
      const final = buf[0];
      const len = buf.readUInt32BE(1);
      if ((final !== 0 && final !== 1) || len < TAG || len > CHUNK + TAG) throw damaged();
      if (buf.length < 5 + len) return;
      const body = buf.subarray(5, 5 + len);
      const decipher = createDecipheriv('aes-256-gcm', key!, nonce(prefix!, counter));
      decipher.setAAD(Buffer.concat([headerBytes, Buffer.from([final])]));
      decipher.setAuthTag(body.subarray(len - TAG));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(body.subarray(0, len - TAG)), decipher.final()]);
      } catch {
        // The first record fails when the passphrase is wrong; a later one only when damaged.
        throw counter === 0
          ? new AgentError(
              'WRONG_PASSPHRASE',
              "This passphrase doesn't open the file. Check it and try again.",
            )
          : damaged();
      }
      counter++;
      if (final === 1) finished = true;
      buf = buf.subarray(5 + len);
      if (plain.length) stream.push(plain);
    }
  }

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      step(this).then(() => done(), done);
    },
    flush(done: TransformCallback) {
      step(this).then(() => {
        if (!headerBytes) return done(notOurs());
        if (!finished || buf.length) return done(damaged());
        done();
      }, done);
    },
  });
}

/**
 * Splits the decrypted plaintext: `manifest` resolves with the manifest, and the stream goes on
 * with the tar that follows it.
 */
export function createManifestSplit(): {
  stream: Transform;
  manifest: Promise<ProfileFileManifest>;
} {
  let resolve!: (m: ProfileFileManifest) => void;
  let reject!: (e: Error) => void;
  const manifest = new Promise<ProfileFileManifest>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  manifest.catch(() => {});
  let buf: Buffer<ArrayBufferLike> | null = Buffer.alloc(0);
  const bad = () =>
    new AgentError('BAD_PROFILE_FILE', "This file's profile details can't be read.");
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!buf) return done(null, chunk);
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return done();
      const len = buf.readUInt32BE(0);
      if (len > MAX_MANIFEST) {
        const e = bad();
        reject(e);
        return done(e);
      }
      if (buf.length < 4 + len) return done();
      let parsed: ProfileFileManifest;
      try {
        parsed = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as ProfileFileManifest;
      } catch {
        const e = bad();
        reject(e);
        return done(e);
      }
      const rest = buf.subarray(4 + len);
      buf = null;
      resolve(parsed);
      done(null, rest.length ? rest : undefined);
    },
    flush(done) {
      if (buf) {
        const e = bad();
        reject(e);
        return done(e);
      }
      done();
    },
  });
  stream.on('error', (e) => reject(e));
  return { stream, manifest };
}

// --- tar filter ----------------------------------------------------------------------------

const BLOCK = 512;

/**
 * Passes a tar stream through, dropping the entries `keep` says no to (with their long-name
 * and pax headers). Data is streamed, never held whole; only headers are buffered.
 */
export function createTarFilter(keep: (path: string) => boolean): Transform {
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let meta: Buffer[] = [];
  let longName: string | null = null;
  let paxPath: string | null = null;
  // Bytes of the current entry's data (padded) still to pass or skip.
  let remaining = 0;
  let passing = true;
  // A meta entry's data (pax or GNU long name), collected whole.
  let collecting: { type: string; size: number; padded: number } | null = null;
  let ended = false;

  function parseHeader(h: Buffer): { path: string; type: string; size: number } {
    const str = (from: number, len: number) =>
      h.toString('utf8', from, from + len).replace(/\0[\s\S]*$/, '');
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    const stored = parseInt(str(148, 8).trim() || 'x', 8);
    if (stored !== sum) throw new Error('tar: bad header checksum');
    let size: number;
    if (h[124]! & 0x80) {
      size = 0;
      for (let i = 125; i < 136; i++) size = size * 256 + h[i]!;
    } else {
      size = parseInt(str(124, 12).trim() || '0', 8);
    }
    const name = str(0, 100);
    const prefix = h.toString('ascii', 257, 262) === 'ustar' ? str(345, 155) : '';
    return {
      path: prefix ? `${prefix}/${name}` : name,
      type: String.fromCharCode(h[156]!) || '0',
      size,
    };
  }

  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        while (buf.length && !ended) {
          if (remaining > 0) {
            const n = Math.min(remaining, buf.length);
            if (passing) this.push(buf.subarray(0, n));
            buf = buf.subarray(n);
            remaining -= n;
            continue;
          }
          if (collecting) {
            if (buf.length < collecting.padded) break;
            const data = buf.subarray(0, collecting.padded);
            meta.push(Buffer.from(data));
            const content = data.subarray(0, collecting.size).toString('utf8');
            if (collecting.type === 'L') longName = content.replace(/\0[\s\S]*$/, '');
            if (collecting.type === 'x') {
              const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(content);
              if (m) paxPath = m[1]!;
            }
            buf = buf.subarray(collecting.padded);
            collecting = null;
            continue;
          }
          if (buf.length < BLOCK) break;
          const h = buf.subarray(0, BLOCK);
          if (h.every((b) => b === 0)) {
            ended = true;
            this.push(Buffer.alloc(BLOCK * 2));
            break;
          }
          const e = parseHeader(h);
          const padded = Math.ceil(e.size / BLOCK) * BLOCK;
          buf = buf.subarray(BLOCK);
          if (e.type === 'x' || e.type === 'L' || e.type === 'K') {
            if (padded > MAX_MANIFEST) throw new Error('tar: header too large');
            meta.push(Buffer.from(h));
            collecting = { type: e.type, size: e.size, padded };
            continue;
          }
          if (e.type === 'g') {
            this.push(Buffer.from(h));
            remaining = padded;
            passing = true;
            continue;
          }
          const path = (paxPath ?? longName ?? e.path).replace(/^\.\//, '');
          passing = keep(path);
          if (passing) {
            for (const m of meta) this.push(m);
            this.push(Buffer.from(h));
          }
          meta = [];
          longName = null;
          paxPath = null;
          remaining = padded;
        }
        if (ended) buf = Buffer.alloc(0);
        done();
      } catch (err) {
        done(err as Error);
      }
    },
    flush(done) {
      if (!ended) return done(new Error('tar: archive ends early'));
      done();
    },
  });
}

/** What an export leaves out: caches the browser rebuilds by itself. */
const CACHE_DIRS = ['data/profile/cache2', 'data/profile/startupCache'];
/** Firefox's lock files: a copy must never look like it's already open. */
const LOCK_FILES = ['data/profile/lock', 'data/profile/.parentlock'];

export function keepOnExport(path: string): boolean {
  const p = path.replace(/\/$/, '');
  if (LOCK_FILES.includes(p)) return false;
  return !CACHE_DIRS.some((d) => p === d || p.startsWith(`${d}/`));
}

/** On import only the profile's data folder is written, nothing that climbs out of it. */
export function keepOnImport(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path !== 'data/' && path !== 'data' && !path.startsWith('data/')) return false;
  return !path.split('/').includes('..');
}

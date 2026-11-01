import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { makeTar } from './docker/tar.js';
import {
  createManifestSplit,
  createOpenStream,
  createSealStream,
  createTarFilter,
  keepOnExport,
  keepOnImport,
  manifestBlock,
  type ProfileFileManifest,
} from './profile-file.js';

const PASS = 'correct horse battery';

async function run(input: Buffer, ...steps: NodeJS.ReadWriteStream[]): Promise<Buffer> {
  const out: Buffer[] = [];
  await pipeline(
    Readable.from([input]),
    ...(steps as [NodeJS.ReadWriteStream]),
    new Writable({
      write(chunk: Buffer, _enc, done) {
        out.push(chunk);
        done();
      },
    }),
  );
  return Buffer.concat(out);
}

async function seal(plain: Buffer, pass = PASS): Promise<Buffer> {
  return run(plain, await createSealStream(pass));
}

describe('profile file encryption', () => {
  it('round-trips data larger than one record', async () => {
    const plain = Buffer.alloc(2.5 * 1024 * 1024);
    for (let i = 0; i < plain.length; i++) plain[i] = (i * 7) % 251;
    const file = await seal(plain);
    expect(file.subarray(0, 16).toString()).toBe('ENCLAVE-PROFILE\n');
    expect(file.includes(plain.subarray(1000, 1064))).toBe(false);
    expect((await run(file, createOpenStream(PASS))).equals(plain)).toBe(true);
  });

  it('round-trips an empty plaintext', async () => {
    const file = await seal(Buffer.alloc(0));
    expect((await run(file, createOpenStream(PASS))).length).toBe(0);
  });

  it('refuses a wrong passphrase', async () => {
    const file = await seal(Buffer.from('secret data'));
    await expect(run(file, createOpenStream('wrong passphrase'))).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('refuses a file cut short', async () => {
    const file = await seal(Buffer.alloc(1.5 * 1024 * 1024, 1));
    // Cut inside the final record.
    await expect(
      run(file.subarray(0, file.length - 40), createOpenStream(PASS)),
    ).rejects.toMatchObject({ code: 'BAD_PROFILE_FILE' });
    // Drop the final record entirely: every record left is genuine, but the end is missing.
    const headerEnd = 20 + file.readUInt32BE(16);
    const firstRecordEnd = headerEnd + 5 + 1024 * 1024 + 16;
    expect(file[headerEnd]).toBe(0);
    expect(file[firstRecordEnd]).toBe(1);
    await expect(
      run(file.subarray(0, firstRecordEnd), createOpenStream(PASS)),
    ).rejects.toMatchObject({ code: 'BAD_PROFILE_FILE' });
    const headerOnly = file.subarray(0, 200);
    await expect(run(headerOnly, createOpenStream(PASS))).rejects.toMatchObject({
      code: 'BAD_PROFILE_FILE',
    });
  });

  it('refuses a changed header, a flipped byte, and data after the end', async () => {
    const file = await seal(Buffer.from('secret data'));
    const header = Buffer.from(file);
    // Change the chunk-size digits' neighbour: the salt, still valid base64 and JSON.
    const at = header.indexOf(Buffer.from('"salt":"')) + 8;
    header[at] = header[at] === 0x41 ? 0x42 : 0x41;
    await expect(run(header, createOpenStream(PASS))).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    const flipped = Buffer.from(file);
    flipped[flipped.length - 20]! ^= 1;
    await expect(run(flipped, createOpenStream(PASS))).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    const extra = Buffer.concat([file, Buffer.from('more')]);
    await expect(run(extra, createOpenStream(PASS))).rejects.toMatchObject({
      code: 'BAD_PROFILE_FILE',
    });
  });

  it('refuses a file that is not a profile file', async () => {
    await expect(
      run(Buffer.from('PK\u0003\u0004 a zip'), createOpenStream(PASS)),
    ).rejects.toMatchObject({ code: 'BAD_PROFILE_FILE' });
  });
});

describe('manifest split', () => {
  it('gives the manifest and passes the rest on', async () => {
    const manifest = { format: 1, exportedAt: 'x', appVersion: '0.3.0' } as ProfileFileManifest;
    const split = createManifestSplit();
    const rest = await run(
      Buffer.concat([manifestBlock(manifest), Buffer.from('TAR')]),
      split.stream,
    );
    expect(await split.manifest).toEqual(manifest);
    expect(rest.toString()).toBe('TAR');
  });
});

// --- tar filter ---

/** A tar header block like makeTar's, with any type flag and a long size. */
function header(name: string, type: string, size: number): Buffer {
  const h = makeTar([{ name: 'x', content: '', mode: 0o644 }]).subarray(0, 512);
  const b = Buffer.from(h);
  b.fill(0, 0, 100);
  b.write(name, 0, 100, 'utf8');
  b.write(`${size.toString(8).padStart(11, '0')}\u0000`, 124, 'ascii');
  b[156] = type.charCodeAt(0);
  b.write(' '.repeat(8), 148, 'ascii');
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');
  return b;
}
const pad = (data: Buffer) =>
  Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
const file = (name: string, content: string) =>
  Buffer.concat([header(name, '0', content.length), pad(Buffer.from(content))]);
function pax(path: string): Buffer {
  const rec = ` path=${path}\n`;
  let len = rec.length + 2;
  while (`${len}${rec}`.length !== len) len = `${len}${rec}`.length;
  const body = Buffer.from(`${len}${rec}`);
  return Buffer.concat([header('PaxHeaders/x', 'x', body.length), pad(body)]);
}
function longName(path: string): Buffer {
  const body = Buffer.from(`${path}\u0000`);
  return Buffer.concat([header('././@LongLink', 'L', body.length), pad(body)]);
}
const END = Buffer.alloc(1024);

function names(tar: Buffer): string[] {
  const out: string[] = [];
  let at = 0;
  let override: string | null = null;
  while (at + 512 <= tar.length) {
    const h = tar.subarray(at, at + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/, ''), 8);
    const type = String.fromCharCode(h[156]!);
    const data = tar.subarray(at + 512, at + 512 + size).toString();
    if (type === 'x') override = /path=([^\n]*)/.exec(data)![1]!;
    else if (type === 'L') override = data.replace(/\0.*$/, '');
    else {
      out.push(override ?? h.toString('utf8', 0, 100).replace(/\0.*$/, ''));
      override = null;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe('tar filter', () => {
  const longCache = `data/profile/cache2/entries/${'a'.repeat(120)}`;
  const longKeep = `data/profile/storage/default/${'b'.repeat(120)}`;
  const tar = Buffer.concat([
    header('data/', '5', 0),
    file('data/profile/prefs.js', 'user_pref("a", 1);'),
    header('data/profile/cache2/', '5', 0),
    file('data/profile/cache2/entries/ABC', 'x'.repeat(3000)),
    pax(longCache),
    file('data/profile/cache2/entries/short', 'cached'),
    longName(longKeep),
    file('data/profile/storage/default/short', 'kept'),
    file('data/profile/.parentlock', ''),
    file('data/profile/startupCache/startupCache.8.little', 'y'.repeat(700)),
    file('data/downloads/report.pdf', 'pdf'),
    END,
  ]);

  it('drops caches and lock files on export, keeping long names whole', async () => {
    // Fed in odd-sized pieces, as Docker's stream arrives.
    const pieces: Buffer[] = [];
    for (let i = 0; i < tar.length; i += 333) pieces.push(tar.subarray(i, i + 333));
    const out: Buffer[] = [];
    await pipeline(
      Readable.from(pieces),
      createTarFilter(keepOnExport),
      new Writable({
        write(c: Buffer, _e, done) {
          out.push(c);
          done();
        },
      }),
    );
    const result = Buffer.concat(out);
    expect(names(result)).toEqual([
      'data/',
      'data/profile/prefs.js',
      longKeep,
      'data/downloads/report.pdf',
    ]);
    expect(result.length % 512).toBe(0);
    expect(result.includes(Buffer.from('user_pref("a", 1);'))).toBe(true);
    expect(result.includes(Buffer.from('kept'))).toBe(true);
    expect(result.includes(Buffer.from('cached'))).toBe(false);
  });

  it('on import keeps only the data folder', async () => {
    const hostile = Buffer.concat([
      file('data/profile/prefs.js', 'ok'),
      file('etc/passwd', 'x'),
      file('data/../etc/shadow', 'x'),
      pax('/root/.bashrc'),
      file('data/innocent', 'x'),
      END,
    ]);
    const result = await run(hostile, createTarFilter(keepOnImport));
    expect(names(result)).toEqual(['data/profile/prefs.js']);
  });

  it('refuses a tar that ends early', async () => {
    await expect(
      run(file('data/a', 'x'.repeat(2000)).subarray(0, 900), createTarFilter(keepOnImport)),
    ).rejects.toThrow(/tar:/);
  });
});

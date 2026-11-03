// Just enough tar (ustar) to put a few small files into a container with putArchive.

export interface TarEntry {
  /** Path inside the archive, e.g. `config/profile.json`. Directories end with `/`. */
  name: string;
  content?: string | Buffer;
  mode: number;
}

const BLOCK = 512;

export function makeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const isDir = entry.name.endsWith('/');
    const data = isDir ? Buffer.alloc(0) : Buffer.from(entry.content ?? '');
    parts.push(tarHeader(entry.name, data.length, entry.mode), data, tarPadding(data.length));
  }
  parts.push(tarEnd());
  return Buffer.concat(parts);
}

/** One entry's ustar header: for a directory, end the name with `/` and give size 0. */
export function tarHeader(name: string, size: number, mode: number): Buffer {
  const isDir = name.endsWith('/');
  if (Buffer.byteLength(name) > 100) throw new Error(`tar: name too long: ${name}`);
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii'); // uid: root
  header.write(octal(0, 8), 116, 'ascii'); // gid: root
  header.write(octal(size, 12), 124, 'ascii');
  header.write(octal(Math.floor(Date.now() / 1000), 12), 136, 'ascii');
  header.write(' '.repeat(8), 148, 'ascii'); // checksum counted as spaces
  header.write(isDir ? '5' : '0', 156, 'ascii');
  header.write('ustar\u000000', 257, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');
  return header;
}

/** Zero bytes after an entry's data, up to the next 512-byte block. */
export function tarPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

/** The two empty blocks that end an archive. */
export function tarEnd(): Buffer {
  return Buffer.alloc(BLOCK * 2);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\u0000`;
}

/**
 * Docker's multiplexed log format (no TTY): frames of [stream, 0, 0, 0, size (uint32 BE)]
 * followed by the payload. Returns stdout and stderr separately.
 */
export function demuxLogs(buf: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i]!;
    const size = buf.readUInt32BE(i + 4);
    const payload = buf.subarray(i + 8, i + 8 + size);
    (stream === 2 ? err : out).push(payload);
    i += 8 + size;
  }
  return {
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
  };
}

/** The first regular file in a tar (what docker cp of one file gives). */
export function readTarFile(tar: Buffer): Buffer {
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const start = at + BLOCK;
    if (type === '0' || type === '\0') {
      if (start + size > tar.length) throw new Error('tar: truncated file');
      return tar.subarray(start, start + size);
    }
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('tar: no file in the archive');
}

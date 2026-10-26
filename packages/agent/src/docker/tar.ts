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
  const mtime = Math.floor(Date.now() / 1000);
  for (const entry of entries) {
    const isDir = entry.name.endsWith('/');
    const data = isDir ? Buffer.alloc(0) : Buffer.from(entry.content ?? '');
    if (Buffer.byteLength(entry.name) > 100) throw new Error(`tar: name too long: ${entry.name}`);

    const header = Buffer.alloc(BLOCK);
    header.write(entry.name, 0, 100, 'utf8');
    header.write(octal(entry.mode, 8), 100, 'ascii');
    header.write(octal(0, 8), 108, 'ascii'); // uid: root
    header.write(octal(0, 8), 116, 'ascii'); // gid: root
    header.write(octal(data.length, 12), 124, 'ascii');
    header.write(octal(mtime, 12), 136, 'ascii');
    header.write(' '.repeat(8), 148, 'ascii'); // checksum counted as spaces
    header.write(isDir ? '5' : '0', 156, 'ascii');
    header.write('ustar\u000000', 257, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 'ascii');

    parts.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
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

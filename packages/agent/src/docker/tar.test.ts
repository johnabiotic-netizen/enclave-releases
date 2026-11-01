import { describe, expect, it } from 'vitest';
import { demuxLogs, makeTar, readTarFile } from './tar.js';

describe('makeTar', () => {
  it('writes ustar headers with valid checksums, padded data and the end marker', () => {
    const tar = makeTar([
      { name: 'config/', mode: 0o755 },
      { name: 'config/a.json', mode: 0o600, content: '{"x":1}' },
    ]);
    expect(tar.length).toBe(512 * 2 + 512 + 512 * 2); // dir header, file header + 1 data block, end

    for (const offset of [0, 512]) {
      const header = tar.subarray(offset, offset + 512);
      const stored = parseInt(header.subarray(148, 154).toString('ascii'), 8);
      const copy = Buffer.from(header);
      copy.fill(0x20, 148, 156);
      expect(copy.reduce((sum, b) => sum + b, 0)).toBe(stored);
      expect(header.subarray(257, 262).toString('ascii')).toBe('ustar');
    }
    expect(tar.subarray(0, 7).toString()).toBe('config/');
    expect(tar[156]).toBe('5'.charCodeAt(0));
    expect(tar.subarray(512 + 100, 512 + 107).toString()).toBe('0000600');
    expect(tar.subarray(1024, 1031).toString()).toBe('{"x":1}');
  });
});

describe('demuxLogs', () => {
  it('splits stdout and stderr frames', () => {
    const frame = (stream: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = stream;
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    const out = demuxLogs(Buffer.concat([frame(1, '{"a":'), frame(2, 'warn'), frame(1, '1}')]));
    expect(out).toEqual({ stdout: '{"a":1}', stderr: 'warn' });
  });
});

describe('readTarFile', () => {
  it('gives the first regular file of an archive', () => {
    const content = Buffer.from('a downloaded file\n'.repeat(100));
    const tar = makeTar([
      { name: 'downloads/', mode: 0o755 },
      { name: 'downloads/report.pdf', mode: 0o644, content },
    ]);
    expect(readTarFile(tar).equals(content)).toBe(true);
  });

  it('refuses an archive without a file', () => {
    expect(() => readTarFile(makeTar([{ name: 'empty/', mode: 0o755 }]))).toThrow(/no file/);
  });
});

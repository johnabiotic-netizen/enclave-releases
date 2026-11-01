import { describe, expect, it } from 'vitest';
import { makeTar, readTarFile } from './tar.js';

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

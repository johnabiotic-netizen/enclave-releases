import { describe, expect, it } from 'vitest';
import { phoneFileName } from './profiles.js';

describe('phoneFileName', () => {
  it('keeps a normal phone name', () => {
    expect(phoneFileName('IMG_2041.HEIC')).toBe('IMG_2041.HEIC');
    expect(phoneFileName('photo test é.jpg')).toBe('photo test é.jpg');
  });
  it('drops folders and control characters', () => {
    expect(phoneFileName('../../etc/passwd')).toBe('passwd');
    expect(phoneFileName('C:\\Users\\me\\a.txt')).toBe('a.txt');
    expect(phoneFileName('a\nb\u0000.txt')).toBe('ab.txt');
  });
  it('never gives an empty or dot name', () => {
    expect(phoneFileName('')).toBe('file');
    expect(phoneFileName('..')).toBe('file');
    expect(phoneFileName('dir/')).toBe('file');
  });
  it('cuts long names to 60 bytes, keeping the extension', () => {
    const name = phoneFileName(`${'é'.repeat(50)}.jpeg`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(60);
    expect(name.endsWith('.jpeg')).toBe(true);
    expect(name.startsWith('éé')).toBe(true);
  });
});

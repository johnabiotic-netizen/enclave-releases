import { describe, expect, it } from 'vitest';
import { versionBelow } from './version.js';

describe('versionBelow', () => {
  it('compares numerically, not as text', () => {
    expect(versionBelow('0.1.0', '0.2.0')).toBe(true);
    expect(versionBelow('0.2.0', '0.2.0')).toBe(false);
    expect(versionBelow('0.10.0', '0.2.0')).toBe(false);
    expect(versionBelow('1.0.0', '0.9.9')).toBe(false);
  });
  it('treats a missing or odd version as too old', () => {
    expect(versionBelow(undefined, '0.2.0')).toBe(true);
    expect(versionBelow('beta', '0.2.0')).toBe(true);
  });
  it('lets everything through when the minimum itself is not a version', () => {
    expect(versionBelow('0.1.0', '')).toBe(false);
  });
});

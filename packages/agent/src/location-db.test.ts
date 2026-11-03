import { describe, expect, it } from 'vitest';
import { validManifest } from './location-db.js';

const good = {
  format: 1,
  tag: '2026.10.28',
  file: 'location-database-2026.10.28.mmdb.gz',
  sha256: 'a'.repeat(64),
  gzSha256: 'b'.repeat(64),
  bytes: 120_618_300,
  publishedAt: '2026-11-03T15:12:58Z',
};

describe('validManifest', () => {
  it('takes the list the workflow publishes', () => {
    expect(validManifest(good)).toBe(true);
  });

  it('refuses a file name that is not the one for its tag', () => {
    expect(validManifest({ ...good, file: '../../evil.mmdb.gz' })).toBe(false);
    expect(validManifest({ ...good, file: 'location-database-2026.10.21.mmdb.gz' })).toBe(false);
  });

  it('refuses a missing hash, an odd tag and an absurd size', () => {
    expect(validManifest({ ...good, sha256: 'x' })).toBe(false);
    expect(validManifest({ ...good, tag: 'latest' })).toBe(false);
    expect(validManifest({ ...good, bytes: 10 })).toBe(false);
    expect(validManifest({ ...good, bytes: 10 * 1024 ** 3 })).toBe(false);
    expect(validManifest(null)).toBe(false);
  });
});

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  b64urlEncode,
  formatLicenseKey,
  parseLicenseKey,
  type LicensePayload,
} from '@enclave/shared';
import { verifyLicenseKey } from './license.js';
import { ProfileService } from './profiles.js';

const pair = generateKeyPairSync('ed25519');
const pubB64 = b64urlEncode(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
const base: LicensePayload = {
  v: 1,
  id: 'abcDEF123456',
  name: 'Test User',
  issued: '2026-11-18',
  expires: '2026-12-18',
  pcs: 1,
};
function make(p: LicensePayload, key = pair.privateKey): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return formatLicenseKey(bytes, sign(null, bytes, key));
}
const on = new Date('2026-12-01T12:00:00Z');

describe('license keys', () => {
  it('accepts a key the owner signed', () => {
    const r = verifyLicenseKey(make(base), pubB64, on);
    expect(r.ok && r.payload.name).toBe('Test User');
  });
  it('is valid through the whole expiry day, then expired', () => {
    expect(verifyLicenseKey(make(base), pubB64, new Date('2026-12-18T23:59:00Z')).ok).toBe(true);
    expect(verifyLicenseKey(make(base), pubB64, new Date('2026-12-19T00:00:01Z'))).toEqual({
      ok: false,
      problem: 'expired',
    });
  });
  it('rejects a key signed by someone else', () => {
    const other = generateKeyPairSync('ed25519');
    expect(verifyLicenseKey(make(base, other.privateKey), pubB64, on)).toEqual({
      ok: false,
      problem: 'bad-signature',
    });
  });
  it('rejects a changed payload (a longer expiry)', () => {
    const [p, s] = make(base).slice(5).split('.');
    const forged = new TextEncoder().encode(JSON.stringify({ ...base, expires: '2099-01-01' }));
    expect(verifyLicenseKey(`ENC1-${b64urlEncode(forged)}.${s}`, pubB64, on)).toEqual({
      ok: false,
      problem: 'bad-signature',
    });
    expect(p).toBeTruthy();
  });
  it('rejects junk and tolerates pasted whitespace', () => {
    expect(verifyLicenseKey('hello', pubB64, on)).toEqual({ ok: false, problem: 'malformed' });
    expect(verifyLicenseKey('ENC1-x.y', pubB64, on)).toEqual({ ok: false, problem: 'malformed' });
    const k = make(base);
    expect(parseLicenseKey(`  ${k.slice(0, 30)}\n${k.slice(30)}  `)).not.toBeNull();
  });
  it('refuses everything while no public key is set', () => {
    expect(verifyLicenseKey(make(base), '', on)).toEqual({ ok: false, problem: 'bad-signature' });
  });
});

describe('license gate on starting a profile', () => {
  const fake = {} as never;
  const make = (gate: () => string | null) =>
    new ProfileService(fake, fake, fake, undefined, undefined, undefined, gate);

  it('refuses to start a profile while unlicensed, with the reason', async () => {
    const service = make(() => 'Enclave needs a license to start a profile.');
    await expect(service.start('anything')).rejects.toMatchObject({
      code: 'LICENSE_REQUIRED',
      message: 'Enclave needs a license to start a profile.',
    });
  });

  it('goes on to the normal start when licensed', async () => {
    const service = make(() => null);
    // The fakes know nothing, so it fails later and elsewhere: not with LICENSE_REQUIRED.
    await expect(service.start('anything')).rejects.not.toMatchObject({ code: 'LICENSE_REQUIRED' });
  });
});

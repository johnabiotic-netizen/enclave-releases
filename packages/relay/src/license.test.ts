import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { b64urlEncode, formatLicenseKey, type LicensePayload } from '@enclave/shared';
import { checkLicense } from './license.js';
import { RelayStore } from './store.js';

const dir = mkdtempSync(path.join(tmpdir(), 'enclave-lic-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const pair = generateKeyPairSync('ed25519');
const pub = b64urlEncode(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
const payload: LicensePayload = {
  v: 1,
  id: 'testKey12345',
  name: 'Tester',
  issued: '2026-11-18',
  expires: '2026-12-18',
  pcs: 1,
};
const bytes = new TextEncoder().encode(JSON.stringify(payload));
const key = formatLicenseKey(bytes, sign(null, bytes, pair.privateKey));
const pcA = 'a'.repeat(64);
const pcB = 'b'.repeat(64);
const now = new Date('2026-12-01T00:00:00Z');
const check = (store: RelayStore, k: string, pc: string, at = now) =>
  checkLicense(store, k, pc, at, pub);

describe('relay license checks', () => {
  it('binds a key to the first PC and refuses a second one', async () => {
    const store = new RelayStore(path.join(dir, 'a'));
    await store.load();
    expect((await check(store, key, pcA)).status).toBe('ok');
    expect((await check(store, key, pcA)).status).toBe('ok');
    expect((await check(store, key, pcB)).status).toBe('other-pc');
  });

  it('lets the owner move a key to a new PC with reset-pc', async () => {
    const store = new RelayStore(path.join(dir, 'b'));
    await store.load();
    await check(store, key, pcA);
    await store.setLicense(payload.id, 'reset-pc');
    expect((await check(store, key, pcB)).status).toBe('ok');
    expect((await check(store, key, pcA)).status).toBe('other-pc');
  });

  it('revokes, and unrevokes, a key', async () => {
    const store = new RelayStore(path.join(dir, 'c'));
    await store.load();
    await check(store, key, pcA);
    await store.setLicense(payload.id, 'revoke');
    expect((await check(store, key, pcA)).status).toBe('revoked');
    await store.setLicense(payload.id, 'unrevoke');
    expect((await check(store, key, pcA)).status).toBe('ok');
  });

  it('can revoke a key that was never used, so it is dead on first use', async () => {
    const store = new RelayStore(path.join(dir, 'd'));
    await store.load();
    expect(await store.setLicense(payload.id, 'revoke')).toBe(true);
    expect((await check(store, key, pcA)).status).toBe('revoked');
    expect(await store.setLicense('nope-nope-nope', 'reset-pc')).toBe(false);
  });

  it('refuses an expired key, a forged key and junk', async () => {
    const store = new RelayStore(path.join(dir, 'e'));
    await store.load();
    expect((await check(store, key, pcA, new Date('2026-12-19T00:00:01Z'))).status).toBe('expired');
    const other = generateKeyPairSync('ed25519');
    const forged = formatLicenseKey(bytes, sign(null, bytes, other.privateKey));
    expect((await check(store, forged, pcA)).status).toBe('invalid');
    expect((await check(store, 'nonsense-key', pcA)).status).toBe('invalid');
  });

  it('keeps bindings after a restart', async () => {
    const d = path.join(dir, 'f');
    const first = new RelayStore(d);
    await first.load();
    await check(first, key, pcA);
    const again = new RelayStore(d);
    await again.load();
    expect((await check(again, key, pcB)).status).toBe('other-pc');
  });
});

describe('relay license routes', () => {
  it('answers the check, validates input, and keeps admin routes to the owner', async () => {
    const { buildRelay } = await import('./server.js');
    const relay = await buildRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(dir, 'http'),
      staticDir: path.join(dir, 'static'),
      signup: 'invite',
      inviteCode: 'x'.repeat(20),
      trustProxy: false,
      turn: {
        secret: 'x'.repeat(40),
        host: 'r.example.com',
        ip: '203.0.113.7',
        port: 3478,
        tlsPort: 5349,
      },
    });
    try {
      const post = (body: unknown) =>
        relay.app.inject({ method: 'POST', url: '/r/v1/license/check', payload: body as object });
      const junk = await post({ key: 'not-a-real-license-key', pc: pcA });
      expect(junk.statusCode).toBe(200);
      expect(junk.json()).toEqual({ status: 'invalid' });
      expect((await post({ key: 'not-a-real-license-key', pc: 'short' })).statusCode).toBe(400);
      expect((await post({ key: 'x' })).statusCode).toBe(400);
      const admin = await relay.app.inject({
        method: 'GET',
        url: '/r/v1/admin/licenses',
        remoteAddress: '203.0.113.9',
      });
      expect(admin.statusCode).toBe(404);
      const own = await relay.app.inject({
        method: 'GET',
        url: '/r/v1/admin/licenses',
        remoteAddress: '127.0.0.1',
      });
      expect(own.statusCode).toBe(200);
      expect(own.json()).toEqual([]);
    } finally {
      await relay.close();
    }
  });
});

import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileStore, type SecretSealer } from './store.js';

const ID = '0b3f6a2e-5c4d-4e8f-9a1b-2c3d4e5f6a7b';
const homes: string[] = [];

function home(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'enclave-store-'));
  homes.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Stands in for safeStorage: a reversible scramble, so the test can see nothing is plain. */
const sealer: SecretSealer = {
  seal: async (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)),
  open: async (sealed) => Buffer.from(sealed.map((b) => b ^ 0x5a)).toString('utf8'),
};

function addProfile(dir: string, secrets?: object): string {
  const folder = path.join(dir, 'profiles', ID);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, 'profile.json'),
    JSON.stringify({ id: ID, createdAt: '2026-10-31' }),
  );
  if (secrets) writeFileSync(path.join(folder, 'secrets.json'), JSON.stringify(secrets));
  return folder;
}

describe('ProfileStore secrets', () => {
  it('without a sealer keeps plain secrets.json (developer CLI)', async () => {
    const dir = home();
    const folder = addProfile(dir);
    const store = new ProfileStore(dir);
    await store.saveSecrets(ID, { proxyPassword: 'hunter2-proxy' });
    expect(JSON.parse(readFileSync(path.join(folder, 'secrets.json'), 'utf8'))).toEqual({
      proxyPassword: 'hunter2-proxy',
    });
    expect(await store.getSecrets(ID)).toEqual({ proxyPassword: 'hunter2-proxy' });
  });

  it('with a sealer writes only secrets.sealed, with no password in it', async () => {
    const dir = home();
    const folder = addProfile(dir);
    const store = new ProfileStore(dir, sealer);
    await store.saveSecrets(ID, { proxyPassword: 'hunter2-proxy' });
    expect(existsSync(path.join(folder, 'secrets.json'))).toBe(false);
    const raw = readFileSync(path.join(folder, 'secrets.sealed'));
    expect(raw.includes('hunter2-proxy')).toBe(false);
    expect(await store.getSecrets(ID)).toEqual({ proxyPassword: 'hunter2-proxy' });
  });

  it('seals a plain secrets.json the first time the app reads it', async () => {
    const dir = home();
    const folder = addProfile(dir, { proxyPassword: 'hunter2-proxy' });
    const store = new ProfileStore(dir, sealer);
    expect(await store.getSecrets(ID)).toEqual({ proxyPassword: 'hunter2-proxy' });
    expect(existsSync(path.join(folder, 'secrets.json'))).toBe(false);
    expect(existsSync(path.join(folder, 'secrets.sealed'))).toBe(true);
  });

  it('sealAll seals every profile at start', async () => {
    const dir = home();
    const folder = addProfile(dir, { proxyPassword: 'hunter2-proxy' });
    expect(await new ProfileStore(dir, sealer).sealAll()).toBe(1);
    expect(existsSync(path.join(folder, 'secrets.json'))).toBe(false);
    expect(await new ProfileStore(dir, sealer).sealAll()).toBe(0);
  });

  it('refuses sealed secrets without a sealer instead of starting with none', async () => {
    const dir = home();
    addProfile(dir);
    await new ProfileStore(dir, sealer).saveSecrets(ID, { proxyPassword: 'hunter2-proxy' });
    await expect(new ProfileStore(dir).getSecrets(ID)).rejects.toMatchObject({
      code: 'SECRETS_LOCKED',
    });
  });

  it('a profile with no secrets yet has none', async () => {
    const dir = home();
    addProfile(dir);
    expect(await new ProfileStore(dir, sealer).getSecrets(ID)).toEqual({});
  });
});

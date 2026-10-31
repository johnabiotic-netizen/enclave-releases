// The profile store on the host: <home>/profiles/<id>/{profile.json, secrets, agent.log}.
// The browser data itself lives in a Docker volume, not here.

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Profile } from '@enclave/shared';
import { AgentError } from './errors.js';

/**
 * A profile's passwords. The Windows app keeps them encrypted for the Windows user
 * (secrets.sealed, through a SecretSealer: Electron safeStorage, DPAPI); an agent without a
 * sealer (the developer CLI) uses plain secrets.json (docs/04-security.md).
 */
export interface ProfileSecrets {
  proxyPassword?: string;
  /** neko logins for the running container; replaced at every start. */
  stream?: {
    userPassword: string;
    adminPassword: string;
    expiresAt: string;
    /** Phone mode: the PC's tailnet name the stream is relayed at. */
    phoneHost?: string;
  };
}

export const PROXY_SECRET_REF = 'profile-secrets#proxyPassword';

/** Encrypts and decrypts a profile's secrets file for the current Windows user. */
export interface SecretSealer {
  seal(plain: string): Promise<Buffer>;
  open(sealed: Buffer): Promise<string>;
}

const PLAIN = 'secrets.json';
const SEALED = 'secrets.sealed';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ProfileStore {
  readonly dir: string;

  constructor(
    home: string,
    private readonly sealer?: SecretSealer,
  ) {
    this.dir = path.join(home, 'profiles');
  }

  newId(): string {
    return randomUUID();
  }

  private folder(id: string): string {
    // Ids come from URLs: never let one escape the profiles folder.
    if (!ID_PATTERN.test(id))
      throw new AgentError('PROFILE_NOT_FOUND', `No profile with id "${id}".`);
    return path.join(this.dir, id);
  }

  async list(): Promise<Profile[]> {
    await mkdir(this.dir, { recursive: true });
    const ids = (await readdir(this.dir)).filter((name) => ID_PATTERN.test(name));
    const profiles = await Promise.all(ids.map((id) => this.get(id).catch(() => null)));
    return profiles
      .filter((p): p is Profile => p !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Profile> {
    try {
      return JSON.parse(
        await readFile(path.join(this.folder(id), 'profile.json'), 'utf8'),
      ) as Profile;
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw new AgentError('PROFILE_NOT_FOUND', `No profile with id "${id}".`);
    }
  }

  async save(profile: Profile): Promise<void> {
    await this.writeJson(profile.id, 'profile.json', profile);
  }

  async getSecrets(id: string): Promise<ProfileSecrets> {
    const folder = this.folder(id);
    const sealed = await readOptional(path.join(folder, SEALED));
    if (sealed) {
      if (!this.sealer) {
        throw new AgentError(
          'SECRETS_LOCKED',
          "This profile's passwords are protected by the Enclave app. Use the app for it.",
        );
      }
      return JSON.parse(await this.sealer.open(sealed)) as ProfileSecrets;
    }
    const plain = await readOptional(path.join(folder, PLAIN));
    if (!plain) return {};
    const secrets = JSON.parse(plain.toString('utf8')) as ProfileSecrets;
    // The app seals a profile's plain secrets the first time it reads them.
    if (this.sealer) await this.saveSecrets(id, secrets);
    return secrets;
  }

  async saveSecrets(id: string, secrets: ProfileSecrets): Promise<void> {
    if (!this.sealer) {
      await this.writeJson(id, PLAIN, secrets);
      return;
    }
    const folder = this.folder(id);
    await mkdir(folder, { recursive: true });
    await writeAtomic(path.join(folder, SEALED), await this.sealer.seal(JSON.stringify(secrets)));
    // Only once the sealed copy is in place.
    await rm(path.join(folder, PLAIN), { force: true });
  }

  /** Seals every profile's plain secrets now (the app does this at start). */
  async sealAll(): Promise<number> {
    if (!this.sealer) return 0;
    let sealed = 0;
    for (const profile of await this.list()) {
      if (await readOptional(path.join(this.folder(profile.id), PLAIN))) {
        await this.getSecrets(profile.id);
        sealed++;
      }
    }
    return sealed;
  }

  async remove(id: string): Promise<void> {
    await rm(this.folder(id), { recursive: true, force: true });
  }

  /** One JSON line per event. Callers must never pass secrets. */
  async log(id: string, event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
    await mkdir(this.folder(id), { recursive: true });
    await appendFile(path.join(this.folder(id), 'agent.log'), `${line}\n`, 'utf8');
  }

  async tailLog(id: string, lines: number): Promise<string[]> {
    try {
      const text = await readFile(path.join(this.folder(id), 'agent.log'), 'utf8');
      return text.split('\n').filter(Boolean).slice(-lines);
    } catch {
      return [];
    }
  }

  private async writeJson(id: string, file: string, value: unknown): Promise<void> {
    const folder = this.folder(id);
    await mkdir(folder, { recursive: true });
    await writeAtomic(path.join(folder, file), `${JSON.stringify(value, null, 2)}\n`);
  }
}

async function writeAtomic(target: string, data: string | Buffer): Promise<void> {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, target);
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

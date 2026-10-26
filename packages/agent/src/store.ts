// The profile store on the host: <home>/profiles/<id>/{profile.json, secrets.json, agent.log}.
// The browser data itself lives in a Docker volume, not here.

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Profile } from '@enclave/shared';
import { AgentError } from './errors.js';

/**
 * Stage 1 keeps secrets in a git-ignored file per profile (docs/04-security.md); Stage 5
 * moves them to the OS credential store. `ProxyConfig.secretRef` points here.
 */
export interface ProfileSecrets {
  proxyPassword?: string;
  /** neko logins for the running container; replaced at every start. */
  stream?: { userPassword: string; adminPassword: string; expiresAt: string };
}

export const PROXY_SECRET_REF = 'file:secrets.json#proxyPassword';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ProfileStore {
  readonly dir: string;

  constructor(home: string) {
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
    try {
      return JSON.parse(
        await readFile(path.join(this.folder(id), 'secrets.json'), 'utf8'),
      ) as ProfileSecrets;
    } catch {
      return {};
    }
  }

  async saveSecrets(id: string, secrets: ProfileSecrets): Promise<void> {
    await this.writeJson(id, 'secrets.json', secrets);
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
    const target = path.join(folder, file);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temp, target);
  }
}

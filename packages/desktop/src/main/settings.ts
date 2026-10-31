// The app's own settings, in <home>/app-settings.json. Secrets in it are encrypted with
// Electron's safeStorage (DPAPI on Windows: readable only by this Windows user).

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';

export interface AppSettings {
  /** The agent token, encrypted (base64). Made on first run. */
  agentTokenEnc?: string;
  /** WSL distro running Docker Engine, on a PC without Docker Desktop. */
  wslDistro?: string;
  /** Phone access over Tailscale. */
  phone?: 'tailscale';
}

export class SettingsFile {
  constructor(private readonly home: string) {}

  private get file(): string {
    return path.join(this.home, 'app-settings.json');
  }

  async read(): Promise<AppSettings> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as AppSettings;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async write(settings: AppSettings): Promise<void> {
    await mkdir(this.home, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  /**
   * The agent token. Made once (or taken once from `fromEnv`, a developer's .env, so a phone
   * already paired with it keeps working) and kept encrypted.
   */
  async agentToken(fromEnv: string | undefined): Promise<string> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("Windows could not protect Enclave's secrets for this user.");
    }
    const settings = await this.read();
    if (settings.agentTokenEnc) {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
        Buffer.from(settings.agentTokenEnc, 'base64'),
      );
      if (shouldReEncrypt) await this.saveToken(settings, result);
      return result;
    }
    const token = fromEnv && fromEnv.length >= 24 ? fromEnv : randomBytes(32).toString('base64url');
    await this.saveToken(settings, token);
    return token;
  }

  private async saveToken(settings: AppSettings, token: string): Promise<void> {
    const enc = await safeStorage.encryptStringAsync(token);
    await this.write({ ...settings, agentTokenEnc: enc.toString('base64') });
  }
}

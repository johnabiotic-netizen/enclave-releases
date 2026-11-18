// The app's license: the key (sealed with Windows' credential store), the daily relay check, and
// what the rest of the app asks ("may a profile start?"). The decisions are in license-logic.ts.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { verifyLicenseKey } from '@enclave/agent';
import type { LicenseCheckResponse, LicenseStatus } from '@enclave/shared';
import { decide, needsCheck, type Online } from './license-logic.js';

const DEFAULT_URL = 'https://relay.kybridia.com';

interface Stored {
  keyEnc?: string;
  /** ISO time of the last good relay check. */
  lastGood?: string | null;
}

/** SHA-256 of Windows' machine id with an Enclave salt: what the relay locks a key to. The id itself is never sent. */
export async function pcHash(): Promise<string> {
  const guid = await new Promise<string>((resolve, reject) => {
    execFile(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { windowsHide: true },
      (err, out) => {
        const m = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out);
        if (err || !m) reject(err ?? new Error('No machine id.'));
        else resolve(m[1]!);
      },
    );
  });
  return createHash('sha256').update(`enclave-license-v1:${guid}`).digest('hex');
}

export class LicenseManager {
  private status: LicenseStatus = { licensed: false };
  private key: string | null = null;
  private lastGood: string | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly home: string,
    /** Only a packaged app (or ENCLAVE_REQUIRE_LICENSE=1) asks for a license: development runs stay open. */
    private readonly enforced: boolean,
    private readonly onChange: (s: LicenseStatus) => void,
    private readonly url = process.env.ENCLAVE_LICENSE_URL || DEFAULT_URL,
  ) {}

  private get file(): string {
    return path.join(this.home, 'license.json');
  }

  /** Loads the stored key and works out the status without waiting for the network. */
  async init(): Promise<void> {
    const stored = await this.read();
    if (stored.keyEnc) {
      try {
        this.key = (
          await safeStorage.decryptStringAsync(Buffer.from(stored.keyEnc, 'base64'))
        ).result;
      } catch {
        this.key = null;
      }
    }
    this.lastGood = stored.lastGood ?? null;
    this.recompute(needsCheck(this.lastGood, new Date()) ? 'unreachable' : null);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 60 * 60 * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  current(): LicenseStatus {
    return this.enforced ? this.status : { licensed: true, name: 'Development build' };
  }

  /** Null when a profile may start; otherwise the reason. */
  blockedReason(): string | null {
    const s = this.current();
    if (s.licensed) return null;
    return 'Enclave needs a license to start a profile. Open Enclave and enter your license key.';
  }

  /** Asks the relay when a check is due (or `force`), then updates the status. */
  async refresh(force = false): Promise<void> {
    if (!this.key || !this.enforced) return;
    if (!force && !needsCheck(this.lastGood, new Date())) return;
    this.recompute(await this.ask(this.key));
    await this.save();
  }

  /** The key box: checks the key, binds it to this PC through the relay, and keeps it if it is good. */
  async activate(rawKey: string): Promise<LicenseStatus> {
    const key = rawKey.trim().replace(/\s+/g, '');
    const local = verifyLicenseKey(key);
    if (!local.ok) return { licensed: false, problem: local.problem };
    const online = await this.ask(key);
    const outcome = decide({ local, online, lastGood: null, now: new Date() });
    if (online !== 'ok') return outcome.status;
    this.key = key;
    this.lastGood = outcome.lastGood;
    this.status = outcome.status;
    await this.save();
    this.onChange(this.current());
    return this.current();
  }

  private recompute(online: Online | null): void {
    if (!this.key) {
      this.status = { licensed: false };
    } else {
      const out = decide({
        local: verifyLicenseKey(this.key),
        online,
        lastGood: this.lastGood,
        now: new Date(),
      });
      this.status = out.status;
      this.lastGood = out.lastGood;
    }
    this.onChange(this.current());
  }

  private async ask(key: string): Promise<Online> {
    try {
      const res = await fetch(`${this.url}/r/v1/license/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, pc: await pcHash() }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return 'unreachable';
      const body = (await res.json()) as Partial<LicenseCheckResponse>;
      const known = ['ok', 'invalid', 'expired', 'revoked', 'other-pc'];
      return known.includes(String(body.status)) ? (body.status as Online) : 'unreachable';
    } catch {
      return 'unreachable';
    }
  }

  private async read(): Promise<Stored> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Stored;
    } catch {
      return {};
    }
  }

  private async save(): Promise<void> {
    if (!this.key) return;
    const keyEnc = (await safeStorage.encryptStringAsync(this.key)).toString('base64');
    await mkdir(this.home, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ keyEnc, lastGood: this.lastGood }), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}

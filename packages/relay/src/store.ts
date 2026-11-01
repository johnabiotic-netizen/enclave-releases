// What the relay keeps: accounts, PCs and paired phones. One small JSON file, written whole
// and atomically. No browsing data, no profile names, no proxy details: the relay never
// receives them (specs/relay-protocol.md).

import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Account {
  id: string;
  email: string;
  /** argon2id, PHC string. */
  passwordHash: string;
  createdAt: string;
}

export interface Pc {
  id: string;
  accountId: string;
  name: string;
  /** SHA-256 of the PC's credential (a random 256-bit value, so a plain hash is enough). */
  secretHash: string;
  /** The PC's tunnel key, handed to phones at pairing (they check it against the QR code). */
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
}

/** One phone paired with one PC. */
export interface Device {
  id: string;
  pcId: string;
  name: string;
  keyHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

/** A single-use invite code for making one account (beta testers). Only its hash is kept. */
export interface Invite {
  id: string;
  codeHash: string;
  /** Who it is for, as the owner wrote it. */
  note: string;
  createdAt: string;
  usedAt: string | null;
  /** The account it made. */
  usedBy: string | null;
}

interface Data {
  version: 1;
  accounts: Account[];
  pcs: Pc[];
  devices: Device[];
  invites?: Invite[];
}

// OWASP's argon2id minimum: 19 MiB, 2 passes, 1 lane.
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;
export const newSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');

export function secretMatches(given: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(given), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function argon(password: string, salt: Buffer, p = ARGON): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await argon(password, salt);
  const { memory: m, passes: t, parallelism: p } = ARGON;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(phc);
  if (!m) return false;
  const want = Buffer.from(m[5]!, 'base64url');
  const got = await argon(password, Buffer.from(m[4]!, 'base64url'), {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: want.length,
  });
  return timingSafeEqual(want, got);
}

/** Spends the same time as a real check, so a wrong email can't be told from a wrong password. */
let dummyHash: Promise<string> | null = null;
export async function verifyNothing(password: string): Promise<false> {
  dummyHash ??= hashPassword(newSecret());
  await verifyPassword(password, await dummyHash);
  return false;
}

export class RelayStore {
  private data: Data = { version: 1, accounts: [], pcs: [], devices: [] };
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'relay.json');
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8')) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await this.save();
    }
  }

  /** Writes the whole file; writes run one after another. */
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    const next = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    this.writing = next.catch(() => {});
    return next;
  }

  accountByEmail(email: string): Account | undefined {
    return this.data.accounts.find((a) => a.email === email);
  }

  async addAccount(email: string, password: string): Promise<Account> {
    const account: Account = {
      id: newId('acc'),
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    this.data.accounts.push(account);
    await this.save();
    return account;
  }

  /** A new invite; the code is shown once and only its hash is kept. */
  async addInvite(note: string): Promise<{ code: string; invite: Invite }> {
    const code = randomBytes(9).toString('base64url');
    const invite: Invite = {
      id: newId('inv'),
      codeHash: hashSecret(code),
      note,
      createdAt: new Date().toISOString(),
      usedAt: null,
      usedBy: null,
    };
    (this.data.invites ??= []).push(invite);
    await this.save();
    return { code, invite };
  }

  invites(): Invite[] {
    return this.data.invites ?? [];
  }

  /** Uses up an unused invite with this code for `email`; false if there is none. */
  async useInvite(code: string, email: string): Promise<boolean> {
    const invite = this.invites().find((i) => !i.usedAt && secretMatches(code, i.codeHash));
    if (!invite) return false;
    invite.usedAt = new Date().toISOString();
    invite.usedBy = email;
    await this.save();
    return true;
  }

  pc(id: string): Pc | undefined {
    return this.data.pcs.find((p) => p.id === id);
  }

  async addPc(
    accountId: string,
    name: string,
    publicKey: string,
  ): Promise<{ pc: Pc; secret: string }> {
    const secret = newSecret();
    const pc: Pc = {
      id: newId('pc'),
      accountId,
      name,
      secretHash: hashSecret(secret),
      publicKey,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    this.data.pcs.push(pc);
    await this.save();
    return { pc, secret };
  }

  /** Removes a PC and every phone paired with it. */
  async removePc(id: string): Promise<Device[]> {
    const gone = this.devicesOf(id);
    this.data.pcs = this.data.pcs.filter((p) => p.id !== id);
    this.data.devices = this.data.devices.filter((d) => d.pcId !== id);
    await this.save();
    return gone;
  }

  device(id: string): Device | undefined {
    return this.data.devices.find((d) => d.id === id);
  }

  devicesOf(pcId: string): Device[] {
    return this.data.devices.filter((d) => d.pcId === pcId);
  }

  async addDevice(pcId: string, name: string): Promise<{ device: Device; key: string }> {
    const key = newSecret();
    const device: Device = {
      id: newId('dev'),
      pcId,
      name,
      keyHash: hashSecret(key),
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    this.data.devices.push(device);
    await this.save();
    return { device, key };
  }

  async removeDevice(id: string): Promise<boolean> {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    if (this.data.devices.length === before) return false;
    await this.save();
    return true;
  }

  /** Last seen, kept to the minute so a busy phone doesn't rewrite the file all the time. */
  async seen(item: Pc | Device): Promise<void> {
    const now = new Date();
    const last = item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0;
    if (now.getTime() - last < 60_000) return;
    item.lastSeenAt = now.toISOString();
    await this.save();
  }
}

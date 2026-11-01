// The PC's link to the relay (Stage 6): signs the PC in, keeps one outbound WebSocket open
// (no inbound ports on the PC), pairs phones, and runs one encrypted session per connected
// phone. The relay only ever gets ciphertext (shared tunnel.ts).
//
// Kept in <home>/relay.json, or relay.sealed with a sealer (the Windows app: safeStorage):
// the relay's address, this PC's credential and tunnel key, and the phones paired with it
// with their keys. The paired list here is what counts: a phone the relay vouches for but
// this PC doesn't know can't open a session.

import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { webcrypto } from 'node:crypto';
import {
  checkPairingProof,
  exportPrivateKey,
  exportPublicKey,
  formatPairingLink,
  generateTunnelKey,
  importKeyPair,
  importPublicKey,
  pcKeyHash,
  PAIRING_SECRET_BYTES,
  RELAY_API_PATH,
  RELAY_CLOSE,
  SESSION_ID_BYTES,
  toBase64Url,
  Tunnel,
  TUNNEL_FRAME,
  type CreatePairingResponse,
  type PairedPhone,
  type PcToRelay,
  type PcTurn,
  type RegisterPcResponse,
  type RelayDevice,
  type RelayPairingResponse,
  type RelaySignInRequest,
  type RelayStatus,
  type RelayToPc,
} from '@enclave/shared';
import { AgentError, InputError } from '../errors.js';
import type { SecretSealer } from '../store.js';
import { TunnelSession, type TunnelBackend } from './session.js';

type KeyPair = webcrypto.CryptoKeyPair;
type JsonWebKey = webcrypto.JsonWebKey;

interface SavedPhone {
  id: string;
  name: string;
  publicKey: string;
  pairedAt: string;
}

interface SavedRelay {
  url: string;
  email: string;
  pcName: string;
  pcId: string;
  pcSecret: string;
  key: JsonWebKey;
  phones: SavedPhone[];
}

const PLAIN = 'relay.json';
const SEALED = 'relay.sealed';
const HTTP_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Accepts "relay.example.com" or a full address; https only, except for this PC itself. */
export function relayUrl(input: string): string {
  let text = input.trim().replace(/\/+$/, '');
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InputError('Enter the relay address, for example relay.example.com.');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new InputError('The relay address must start with https://.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new InputError('Enter only the relay address, without a path.');
  }
  return url.origin;
}

export class RelayLink {
  private saved: SavedRelay | null = null;
  private keys: KeyPair | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private problem: string | undefined;
  private turnInfo: PcTurn | null = null;
  private retry = 0;
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private readonly sessions = new Map<
    string,
    { deviceId: string; tunnel: Tunnel; session: TunnelSession }
  >();
  private readonly pairings = new Map<string, { secret: string; expiresAt: number }>();

  constructor(
    private readonly home: string,
    private readonly backend: TunnelBackend,
    private readonly version: string,
    private readonly sealer?: SecretSealer,
  ) {}

  /** Loads the saved sign-in and, when `connect`, links up (and keeps trying). */
  async start(connect: boolean): Promise<void> {
    this.saved = await this.load();
    if (this.saved) this.keys = await importKeyPair(this.saved.key);
    this.stopped = !connect;
    if (connect && this.saved) this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.endSessions();
    this.ws?.close(1000);
    this.ws = null;
    this.connected = false;
  }

  /** TURN for the profiles' streaming program, while linked. */
  turn(): PcTurn | null {
    return this.connected ? this.turnInfo : null;
  }

  get active(): boolean {
    return !this.stopped;
  }

  // ---------------------------------------------------------------- API for the desktop app

  async status(): Promise<RelayStatus> {
    const s = this.saved;
    if (!s) return { signedIn: false, connected: false, devices: [] };
    // Last seen comes from the relay; the list itself is this PC's own.
    const remote = await this.call<RelayDevice[]>('GET', '/devices').catch(() => null);
    const devices: PairedPhone[] = s.phones.map((p) => ({
      id: p.id,
      name: p.name,
      pairedAt: p.pairedAt,
      lastSeenAt: remote?.find((d) => d.id === p.id)?.lastSeenAt ?? null,
    }));
    return {
      signedIn: true,
      url: s.url,
      email: s.email,
      pcName: s.pcName,
      connected: this.connected,
      ...(this.problem ? { problem: this.problem } : {}),
      devices,
    };
  }

  async signIn(req: RelaySignInRequest): Promise<RelayStatus> {
    const url = relayUrl(String(req.url ?? ''));
    const email = String(req.email ?? '').trim();
    const password = String(req.password ?? '');
    const pcName = String(req.pcName ?? '').trim() || os.hostname();
    if (!email || !password) throw new InputError('Enter the email and password.');
    if (pcName.length > 60) throw new InputError('Keep the PC name under 60 characters.');
    if (req.createAccount) {
      await this.http(url, 'POST', '/accounts', {
        email,
        password,
        ...(req.inviteCode ? { inviteCode: String(req.inviteCode).trim() } : {}),
      });
    }
    const keys = await generateTunnelKey(true);
    const publicKey = await exportPublicKey(keys.publicKey);
    const reg = await this.http<RegisterPcResponse>(url, 'POST', '/pcs', {
      email,
      password,
      name: pcName,
      publicKey,
    });
    // A new sign-in replaces the old one, and its paired phones with it.
    if (this.saved) await this.signOut().catch(() => {});
    this.saved = {
      url,
      email,
      pcName,
      pcId: reg.pcId,
      pcSecret: reg.pcSecret,
      key: await exportPrivateKey(keys.privateKey),
      phones: [],
    };
    this.keys = keys;
    await this.save();
    this.problem = undefined;
    if (!this.stopped) this.open();
    return this.status();
  }

  async signOut(): Promise<void> {
    const s = this.saved;
    if (!s) return;
    // Best effort on the relay; locally the keys go regardless, so no phone gets in again.
    await this.call('DELETE', '/pcs/self').catch(() => {});
    const keep = !this.stopped;
    this.stop();
    this.stopped = !keep;
    this.saved = null;
    this.keys = null;
    this.problem = undefined;
    this.pairings.clear();
    await rm(path.join(this.home, PLAIN), { force: true });
    await rm(path.join(this.home, SEALED), { force: true });
  }

  async pairing(): Promise<RelayPairingResponse> {
    const s = this.requireSaved();
    if (!this.connected) {
      throw new AgentError(
        'RELAY_UNREACHABLE',
        this.problem ?? "This PC isn't connected to the relay yet. Try again in a moment.",
      );
    }
    const res = await this.call<CreatePairingResponse>('POST', '/pairings');
    const secret = toBase64Url(randomBytes(PAIRING_SECRET_BYTES));
    const expiresAt = Date.parse(res.expiresAt);
    for (const [code, p] of this.pairings) if (p.expiresAt < Date.now()) this.pairings.delete(code);
    this.pairings.set(res.code, { secret, expiresAt });
    const hash = await pcKeyHash(await exportPublicKey(this.keys!.publicKey));
    return {
      link: formatPairingLink(s.url, { code: res.code, secret, pcKeyHash: hash }),
      expiresAt: res.expiresAt,
    };
  }

  async revoke(deviceId: string): Promise<void> {
    const s = this.requireSaved();
    if (!s.phones.some((p) => p.id === deviceId)) {
      throw new InputError('This phone is not paired with this PC.');
    }
    // Locally first: from now on this PC refuses the phone, whatever the relay does.
    s.phones = s.phones.filter((p) => p.id !== deviceId);
    await this.save();
    for (const [id, x] of this.sessions)
      if (x.deviceId === deviceId) this.endSession(id, 'Unpaired.');
    await this.call('DELETE', `/devices/${encodeURIComponent(deviceId)}`).catch((e: unknown) => {
      if (e instanceof AgentError && e.code === 'RELAY_REFUSED') return; // already gone there
      throw e;
    });
  }

  // ---------------------------------------------------------------- the socket

  private open(): void {
    const s = this.saved;
    if (!s || this.stopped) return;
    clearTimeout(this.timer);
    const ws = new WebSocket(`${s.url.replace(/^http/, 'ws')}${RELAY_API_PATH}/ws/pc`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: 'REGISTER', pcId: s.pcId, pcSecret: s.pcSecret, version: this.version });
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data === 'string') void this.onControl(JSON.parse(e.data) as RelayToPc);
      else this.onFrame(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.endSessions();
      if (this.stopped) return;
      if (e.code === RELAY_CLOSE.UNAUTHORIZED) {
        this.problem = 'The relay no longer knows this PC. Sign in again.';
        return;
      }
      if (e.code === RELAY_CLOSE.REPLACED) {
        this.problem = 'This PC is signed in to the relay from another Enclave.';
        return;
      }
      this.problem ??= "Can't reach the relay. Enclave keeps trying.";
      const wait = BACKOFF_MS[Math.min(this.retry++, BACKOFF_MS.length - 1)]!;
      this.timer = setTimeout(() => this.open(), wait);
      this.timer.unref?.();
    };
    ws.onerror = () => {
      this.problem = "Can't reach the relay. Enclave keeps trying.";
    };
  }

  private send(msg: PcToRelay): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async onControl(msg: RelayToPc): Promise<void> {
    switch (msg.type) {
      case 'REGISTERED':
        this.connected = true;
        this.retry = 0;
        this.problem = undefined;
        this.turnInfo = msg.turn;
        return;
      case 'PAIRING_REQUEST':
        return this.onPairing(msg);
      case 'SESSION_REQUEST':
        return this.onSession(msg.sessionId, msg.deviceId);
      case 'SESSION_CLOSED':
        this.endSession(msg.sessionId, null);
        return;
      case 'REVOKED':
        for (const [id, x] of this.sessions)
          if (x.deviceId === msg.deviceId) this.endSession(id, null);
        return;
      case 'ERROR':
        this.problem = msg.message;
        return;
    }
  }

  private async onPairing(msg: Extract<RelayToPc, { type: 'PAIRING_REQUEST' }>): Promise<void> {
    const s = this.saved;
    const pending = this.pairings.get(msg.code);
    let ok = false;
    if (s && this.keys && pending && pending.expiresAt > Date.now()) {
      // One try per QR code: a wrong proof uses it up.
      this.pairings.delete(msg.code);
      const hash = await pcKeyHash(await exportPublicKey(this.keys.publicKey));
      ok = await checkPairingProof(pending.secret, msg.publicKey, hash, msg.proof);
      if (ok) {
        await importPublicKey(msg.publicKey); // a real P-256 key, or throw
        s.phones.push({
          id: msg.deviceId,
          name: msg.deviceName.slice(0, 60),
          publicKey: msg.publicKey,
          pairedAt: new Date().toISOString(),
        });
        await this.save();
      }
    }
    this.send({ type: 'PAIRING_RESULT', pairingId: msg.pairingId, ok });
  }

  private async onSession(sessionId: string, deviceId: string): Promise<void> {
    const phone = this.saved?.phones.find((p) => p.id === deviceId);
    if (!phone || !this.keys || !/^[0-9a-f]{32}$/.test(sessionId)) {
      return this.send({
        type: 'SESSION_CLOSE',
        sessionId,
        reason: 'This phone is not paired with this PC. Pair it again.',
      });
    }
    const idBytes = Buffer.from(sessionId, 'hex');
    const ws = this.ws;
    const tunnel = new Tunnel('pc', this.keys, await importPublicKey(phone.publicKey), (bytes) => {
      if (ws?.readyState !== WebSocket.OPEN) return;
      ws.send(Buffer.concat([Buffer.from([TUNNEL_FRAME]), idBytes, bytes]));
    });
    const session = new TunnelSession(tunnel, this.backend, (reason) =>
      this.endSession(sessionId, reason),
    );
    this.sessions.set(sessionId, { deviceId, tunnel, session });
  }

  private onFrame(frame: Uint8Array): void {
    if (frame.length <= 1 + SESSION_ID_BYTES || frame[0] !== TUNNEL_FRAME) return;
    const id = Buffer.from(frame.subarray(1, 1 + SESSION_ID_BYTES)).toString('hex');
    const x = this.sessions.get(id);
    if (!x) return;
    x.tunnel.receive(frame.subarray(1 + SESSION_ID_BYTES));
  }

  /** Ends a session; `reason` set means the relay and the phone should hear of it. */
  private endSession(sessionId: string, reason: string | null): void {
    const x = this.sessions.get(sessionId);
    if (!x) return;
    this.sessions.delete(sessionId);
    x.session.close();
    if (reason !== null) this.send({ type: 'SESSION_CLOSE', sessionId, reason });
  }

  private endSessions(): void {
    for (const id of [...this.sessions.keys()]) this.endSession(id, null);
  }

  // ---------------------------------------------------------------- HTTP and storage

  private requireSaved(): SavedRelay {
    if (!this.saved) throw new InputError('Sign in to the relay first.');
    return this.saved;
  }

  /** A call as this PC. */
  private call<T>(method: string, p: string): Promise<T> {
    const s = this.requireSaved();
    return this.http<T>(s.url, method, p, undefined, `Bearer ${s.pcId}.${s.pcSecret}`);
  }

  private async http<T>(
    url: string,
    method: string,
    p: string,
    body?: unknown,
    authorization?: string,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${url}${RELAY_API_PATH}${p}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authorization ? { Authorization: authorization } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new AgentError(
        'RELAY_UNREACHABLE',
        `Can't reach the relay at ${url}. Check the address and this PC's internet connection.`,
      );
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      const message = json.error?.message ?? `The relay answered HTTP ${res.status}.`;
      throw new AgentError(res.status >= 500 ? 'RELAY_UNREACHABLE' : 'RELAY_REFUSED', message);
    }
    return json;
  }

  private async load(): Promise<SavedRelay | null> {
    if (this.sealer) {
      try {
        const sealed = await readFile(path.join(this.home, SEALED));
        return JSON.parse(await this.sealer.open(sealed)) as SavedRelay;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new AgentError('SECRETS_LOCKED', "Enclave couldn't open its relay sign-in.");
        }
      }
    }
    try {
      const plain = JSON.parse(await readFile(path.join(this.home, PLAIN), 'utf8')) as SavedRelay;
      // The Windows app seals what the developer CLI left in the clear.
      if (this.sealer) {
        this.saved = plain;
        await this.save();
      }
      return plain;
    } catch {
      return null;
    }
  }

  private async save(): Promise<void> {
    if (!this.saved) return;
    const text = JSON.stringify(this.saved, null, 2);
    if (this.sealer) {
      const file = path.join(this.home, SEALED);
      await writeFile(`${file}.tmp`, await this.sealer.seal(text));
      await rename(`${file}.tmp`, file);
      await rm(path.join(this.home, PLAIN), { force: true });
    } else {
      const file = path.join(this.home, PLAIN);
      await writeFile(`${file}.tmp`, text, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    }
  }
}

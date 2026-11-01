// The live side of the relay: PCs and phones connected over WebSockets, the sessions between
// them, and pairings waiting for the PC's answer. Tunnel frames are passed on as they are;
// the relay can't read them (tunnel.ts) and doesn't try.

import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  RELAY_CLOSE,
  SESSION_ID_BYTES,
  TUNNEL_FRAME,
  type PcToRelay,
  type PhoneToRelay,
  type RelayToPc,
  type RelayToPhone,
} from '@enclave/shared';
import type { RelayConfig } from './config.js';
import { secretMatches, type Device, type Pc, type RelayStore } from './store.js';
import { pcTurn, phoneIceServers } from './turn.js';

/** A connection must say who it is within this time. */
const HELLO_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;
/** A side that can't keep up (more than this waiting to be sent) loses the session. */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const MAX_SESSIONS_PER_DEVICE = 4;
/** How long a phone's claim waits for the PC to check the pairing proof. */
const PAIRING_ANSWER_MS = 15_000;

interface Session {
  id: string;
  pcId: string;
  deviceId: string;
  phone: WebSocket;
}

interface PendingPairing {
  pcId: string;
  expiresAt: number;
}

export class Hub {
  private readonly pcs = new Map<string, WebSocket>();
  private readonly phones = new Map<string, Set<WebSocket>>();
  private readonly sessions = new Map<string, Session>();
  private readonly codes = new Map<string, PendingPairing>();
  private readonly answers = new Map<string, (ok: boolean) => void>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly pinger: NodeJS.Timeout;

  constructor(
    private readonly store: RelayStore,
    private readonly config: RelayConfig,
  ) {
    this.pinger = setInterval(() => this.ping(), PING_MS);
    this.pinger.unref();
  }

  close(): void {
    clearInterval(this.pinger);
    for (const ws of this.pcs.values()) ws.terminate();
    for (const set of this.phones.values()) for (const ws of set) ws.terminate();
  }

  isOnline(pcId: string): boolean {
    return this.pcs.has(pcId);
  }

  // ---------------------------------------------------------------- connections

  acceptPc(ws: WebSocket): void {
    let pc: Pc | null = null;
    this.watch(ws);
    const timer = setTimeout(
      () => ws.close(RELAY_CLOSE.UNAUTHORIZED, 'No hello'),
      HELLO_TIMEOUT_MS,
    );
    ws.on('message', (raw, binary) => {
      if (binary) {
        if (pc) this.forward(raw as Buffer, ws, pc.id, null);
        return;
      }
      const msg = parse<PcToRelay>(raw);
      if (!msg) return ws.close(1003, 'Bad message');
      if (!pc) {
        if (msg.type !== 'REGISTER') return ws.close(RELAY_CLOSE.UNAUTHORIZED, 'Register first');
        const found = this.store.pc(msg.pcId);
        if (!found || !secretMatches(msg.pcSecret, found.secretHash)) {
          return ws.close(RELAY_CLOSE.UNAUTHORIZED, 'Unknown PC');
        }
        clearTimeout(timer);
        pc = found;
        const before = this.pcs.get(pc.id);
        if (before) {
          this.dropPcSessions(pc.id, 'The PC connected again.');
          before.close(RELAY_CLOSE.REPLACED, 'Connected elsewhere');
        }
        this.pcs.set(pc.id, ws);
        void this.store.seen(pc);
        sendJson<RelayToPc>(ws, { type: 'REGISTERED', turn: pcTurn(this.config.turn, pc.id) });
        this.tellPhones(pc.id, true);
        return;
      }
      if (msg.type === 'PAIRING_RESULT') {
        this.answers.get(`${pc.id}/${msg.pairingId}`)?.(msg.ok === true);
      } else if (msg.type === 'SESSION_CLOSE') {
        const s = this.sessions.get(msg.sessionId);
        if (s?.pcId === pc.id) this.endSession(s, String(msg.reason ?? ''), 'pc');
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!pc || this.pcs.get(pc.id) !== ws) return;
      this.pcs.delete(pc.id);
      this.dropPcSessions(pc.id, 'Your PC went offline.');
      this.tellPhones(pc.id, false);
    });
  }

  acceptPhone(ws: WebSocket): void {
    let device: Device | null = null;
    this.watch(ws);
    const timer = setTimeout(
      () => ws.close(RELAY_CLOSE.UNAUTHORIZED, 'No hello'),
      HELLO_TIMEOUT_MS,
    );
    ws.on('message', (raw, binary) => {
      if (binary) {
        if (device) this.forward(raw as Buffer, ws, device.pcId, device.id);
        return;
      }
      const msg = parse<PhoneToRelay>(raw);
      if (!msg) return ws.close(1003, 'Bad message');
      if (!device) {
        if (msg.type !== 'HELLO') return ws.close(RELAY_CLOSE.UNAUTHORIZED, 'Hello first');
        const found = this.store.device(msg.deviceId);
        if (!found || !secretMatches(msg.deviceKey, found.keyHash)) {
          return ws.close(RELAY_CLOSE.REVOKED, 'Not paired');
        }
        const pc = this.store.pc(found.pcId);
        if (!pc) return ws.close(RELAY_CLOSE.REVOKED, 'Not paired');
        clearTimeout(timer);
        device = found;
        let set = this.phones.get(device.id);
        if (!set) this.phones.set(device.id, (set = new Set()));
        set.add(ws);
        void this.store.seen(device);
        sendJson<RelayToPhone>(ws, {
          type: 'WELCOME',
          pc: { id: pc.id, name: pc.name, online: this.pcs.has(pc.id) },
        });
        return;
      }
      if (msg.type === 'OPEN_SESSION') this.openSession(ws, device);
      else if (msg.type === 'SESSION_CLOSE') {
        const s = this.sessions.get(msg.sessionId);
        if (s?.phone === ws) this.endSession(s, String(msg.reason ?? ''), 'phone');
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!device) return;
      this.phones.get(device.id)?.delete(ws);
      if (this.phones.get(device.id)?.size === 0) this.phones.delete(device.id);
      for (const s of [...this.sessions.values()]) {
        if (s.phone === ws) this.endSession(s, 'The phone disconnected.', 'phone');
      }
    });
  }

  // ---------------------------------------------------------------- sessions

  private openSession(phone: WebSocket, device: Device): void {
    const pcWs = this.pcs.get(device.pcId);
    if (!pcWs) {
      return sendJson<RelayToPhone>(phone, {
        type: 'SESSION_DENIED',
        reason: 'Your PC is offline. Check that it is on and Enclave is running.',
      });
    }
    const mine = [...this.sessions.values()].filter((s) => s.deviceId === device.id);
    if (mine.length >= MAX_SESSIONS_PER_DEVICE) {
      this.endSession(mine[0]!, 'Too many connections from this phone.', 'relay');
    }
    const id = randomBytes(SESSION_ID_BYTES).toString('hex');
    this.sessions.set(id, { id, pcId: device.pcId, deviceId: device.id, phone });
    sendJson<RelayToPc>(pcWs, { type: 'SESSION_REQUEST', sessionId: id, deviceId: device.id });
    sendJson<RelayToPhone>(phone, {
      type: 'SESSION_GRANTED',
      sessionId: id,
      iceServers: phoneIceServers(this.config.turn, device.id),
    });
  }

  /** A tunnel frame: [1][session id][payload], passed to the session's other side. */
  private forward(frame: Buffer, from: WebSocket, pcId: string, deviceId: string | null): void {
    if (frame.length <= 1 + SESSION_ID_BYTES || frame[0] !== TUNNEL_FRAME) return;
    const id = frame.subarray(1, 1 + SESSION_ID_BYTES).toString('hex');
    const s = this.sessions.get(id);
    if (!s || s.pcId !== pcId) return;
    if (deviceId !== null && (s.deviceId !== deviceId || s.phone !== from)) return;
    const to = deviceId === null ? s.phone : this.pcs.get(pcId);
    if (!to || to.readyState !== to.OPEN) return;
    if (to.bufferedAmount > MAX_BUFFERED_BYTES) {
      return this.endSession(s, 'The connection could not keep up.', 'relay');
    }
    to.send(frame, { binary: true });
  }

  private endSession(s: Session, reason: string, by: 'pc' | 'phone' | 'relay'): void {
    if (!this.sessions.delete(s.id)) return;
    const closed = { type: 'SESSION_CLOSED', sessionId: s.id, reason } as const;
    if (by !== 'pc') {
      const pc = this.pcs.get(s.pcId);
      if (pc) sendJson<RelayToPc>(pc, closed);
    }
    if (by !== 'phone') sendJson<RelayToPhone>(s.phone, closed);
  }

  private dropPcSessions(pcId: string, reason: string): void {
    for (const s of [...this.sessions.values()]) {
      if (s.pcId === pcId) this.endSession(s, reason, 'pc');
    }
  }

  private tellPhones(pcId: string, online: boolean): void {
    for (const d of this.store.devicesOf(pcId)) {
      for (const ws of this.phones.get(d.id) ?? []) {
        sendJson<RelayToPhone>(ws, { type: 'PC_ONLINE', online });
      }
    }
  }

  // ---------------------------------------------------------------- pairing and revoking

  createPairing(pcId: string, ttlMs: number): { code: string; expiresAt: number } {
    const now = Date.now();
    for (const [code, p] of this.codes) if (p.expiresAt <= now) this.codes.delete(code);
    const code = randomBytes(12).toString('base64url');
    const expiresAt = now + ttlMs;
    this.codes.set(code, { pcId, expiresAt });
    return { code, expiresAt };
  }

  /** Takes a pairing code (once). Returns the PC it belongs to, or null. */
  takePairing(code: string): string | null {
    const p = this.codes.get(code);
    this.codes.delete(code);
    return p && p.expiresAt > Date.now() ? p.pcId : null;
  }

  /** Asks the PC to check a phone's pairing proof. False if it says no, is offline or slow. */
  askPc(
    pcId: string,
    request: Omit<Extract<RelayToPc, { type: 'PAIRING_REQUEST' }>, 'type' | 'pairingId'>,
  ): Promise<boolean> {
    const ws = this.pcs.get(pcId);
    if (!ws) return Promise.resolve(false);
    const pairingId = randomBytes(9).toString('base64url');
    const key = `${pcId}/${pairingId}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => done(false), PAIRING_ANSWER_MS);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        this.answers.delete(key);
        resolve(ok);
      };
      this.answers.set(key, done);
      sendJson<RelayToPc>(ws, { type: 'PAIRING_REQUEST', pairingId, ...request });
    });
  }

  /** Cuts a phone off at once: its sockets, its sessions. */
  revoke(deviceId: string): void {
    for (const s of [...this.sessions.values()]) {
      if (s.deviceId === deviceId) this.endSession(s, 'This phone was unpaired.', 'relay');
    }
    for (const ws of this.phones.get(deviceId) ?? []) {
      sendJson<RelayToPhone>(ws, { type: 'REVOKED' });
      ws.close(RELAY_CLOSE.REVOKED, 'Unpaired');
    }
    this.phones.delete(deviceId);
  }

  /** The PC signed out: its connection and every phone paired with it. */
  removePc(pcId: string, devices: Device[]): void {
    for (const d of devices) this.revoke(d.id);
    this.dropPcSessions(pcId, 'The PC signed out.');
    this.pcs.get(pcId)?.close(RELAY_CLOSE.UNAUTHORIZED, 'Signed out');
    this.pcs.delete(pcId);
  }

  // ---------------------------------------------------------------- keepalive

  private watch(ws: WebSocket): void {
    this.alive.add(ws);
    ws.on('pong', () => this.alive.add(ws));
    ws.on('error', () => ws.terminate());
  }

  private ping(): void {
    const all = [...this.pcs.values(), ...[...this.phones.values()].flatMap((s) => [...s])];
    for (const ws of all) {
      if (!this.alive.has(ws)) {
        ws.terminate();
        continue;
      }
      this.alive.delete(ws);
      ws.ping();
    }
  }
}

function parse<T>(raw: unknown): T | null {
  try {
    const msg = JSON.parse(String(raw)) as unknown;
    return msg && typeof msg === 'object' && typeof (msg as { type?: unknown }).type === 'string'
      ? (msg as T)
      : null;
  } catch {
    return null;
  }
}

function sendJson<T>(ws: WebSocket, msg: T): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

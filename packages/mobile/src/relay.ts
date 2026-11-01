// The phone's link to its PC through the Enclave relay (Stage 6). Pairing, the relay socket,
// and the end-to-end encrypted tunnel inside it (shared tunnel.ts): the relay passes the
// bytes on but can't read them. Over the tunnel the app reaches the PC's agent API and the
// running profiles' stream servers, as it reaches them directly over Tailscale.

import {
  BODY_CHUNK_BYTES,
  BODY_WINDOW,
  CHANNEL,
  exportPublicKey,
  generateTunnelKey,
  importPublicKey,
  pairingProof,
  pcKeyHash,
  packChannel,
  RELAY_API_PATH,
  RELAY_CLOSE,
  SESSION_ID_BYTES,
  textOf,
  Tunnel,
  TUNNEL_FRAME,
  unpackChannel,
  unpackResponse,
  type ClaimPairingResponse,
  type IceServer,
  type PairingLink,
  type PhoneToRelay,
  type RelayToPhone,
} from '@enclave/shared';

const VERSION = '0.1.0';

// ------------------------------------------------------------------ the phone's identity

/** This phone's pairing with one PC, kept in IndexedDB (the private key can't be read out). */
export interface Identity {
  deviceId: string;
  deviceKey: string;
  keys: CryptoKeyPair;
  pc: { id: string; name: string; publicKey: string };
}

const DB = 'enclave';
const STORE = 'pairing';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
    });
  } finally {
    d.close();
  }
}

export const loadIdentity = () => idb<Identity | undefined>('readonly', (s) => s.get('current'));
const saveIdentity = (id: Identity) => idb('readwrite', (s) => s.put(id, 'current'));
export const forgetIdentity = () => idb('readwrite', (s) => s.delete('current'));

export class PairingError extends Error {}

/** The phone's half of pairing: a key, the proof made with the QR's secret, the claim. */
export async function pair(link: PairingLink, deviceName: string): Promise<Identity> {
  const keys = await generateTunnelKey(false);
  const publicKey = await exportPublicKey(keys.publicKey);
  // The PC's key isn't known yet; the proof covers the phone's key and the hash in the QR.
  const proof = await pairingProof(link.secret, publicKey, link.pcKeyHash);
  const res = await fetch(`${RELAY_API_PATH}/pairings/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: link.code, deviceName, publicKey, proof }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ClaimPairingResponse> & {
    error?: { message?: string };
  };
  if (!res.ok || !body.pc || !body.deviceId || !body.deviceKey) {
    throw new PairingError(body.error?.message ?? `The relay answered HTTP ${res.status}.`);
  }
  // The key the relay hands over must be the one the PC put in the QR code.
  if ((await pcKeyHash(body.pc.publicKey)) !== link.pcKeyHash) {
    throw new PairingError(
      "The PC's key did not match the QR code, so this phone was not paired. Show a new QR code on the PC and try again.",
    );
  }
  await importPublicKey(body.pc.publicKey);
  const identity: Identity = {
    deviceId: body.deviceId,
    deviceKey: body.deviceKey,
    keys,
    pc: body.pc,
  };
  await saveIdentity(identity);
  return identity;
}

/** A short name for this phone, for the PC's list of paired phones. */
export function phoneName(): string {
  const ua = navigator.userAgent;
  const model = /Android [\d.]+; ([^;)]+)\)/.exec(ua)?.[1]?.trim();
  if (model && model !== 'K') return model.slice(0, 60);
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Phone';
}

// ------------------------------------------------------------------ the link

export type LinkState =
  | { kind: 'connecting' }
  | { kind: 'ready' }
  | { kind: 'pc-offline' }
  | { kind: 'revoked' }
  | { kind: 'failed'; message: string };

export interface TunnelResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

interface PendingRequest {
  resolve: (r: TunnelResponse) => void;
  reject: (e: Error) => void;
  /** Body pieces sent and not yet taken by the PC. */
  inFlight: number;
  wake: (() => void) | null;
}

const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * One phone's connection to its PC: the relay socket and, inside it, one tunnel session at a
 * time. Survives network changes: a lost socket comes back by itself with a new session.
 */
export class RelayLink {
  state: LinkState = { kind: 'connecting' };
  iceServers: IceServer[] = [];
  onState: (s: LinkState) => void = () => {};

  private ws: WebSocket | null = null;
  private sessionId: Uint8Array | null = null;
  private tunnel: Tunnel | null = null;
  private nextChannel = 1;
  private readonly requests = new Map<number, PendingRequest>();
  private readonly sockets = new Map<number, VirtualSocket>();
  private retry = 0;
  private timer = 0;
  private stopped = false;
  private waiters: (() => void)[] = [];

  constructor(readonly identity: Identity) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.ws?.close(1000);
    this.endSession(new Error('Closed.'));
  }

  /** Try again now (the app came back to the screen, or the network did). */
  wake(): void {
    if (this.stopped || this.state.kind === 'revoked') return;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      window.clearTimeout(this.timer);
      this.retry = 0;
      this.connect();
    }
  }

  /** Waits for a session with the PC (or gives up after `ms`). Its tunnel holds messages until
   * its keys are agreed, so a request can go as soon as the session exists. */
  async ready(ms = 15_000): Promise<Tunnel> {
    if (this.tunnel) return this.tunnel;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(this.describe())), ms);
      this.waiters.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    if (!this.tunnel) throw new Error(this.describe());
    return this.tunnel;
  }

  describe(): string {
    switch (this.state.kind) {
      case 'pc-offline':
        return `${this.identity.pc.name} is offline. Check that it's on and Enclave is running.`;
      case 'revoked':
        return 'This phone was unpaired on the PC.';
      case 'failed':
        return this.state.message;
      default:
        return "Can't reach your PC right now. Check the phone's connection.";
    }
  }

  // ---------------------------------------------------------------- requests and sockets

  /** One request to the PC (agent API or a profile's stream server), with an optional body. */
  async request(
    method: string,
    path: string,
    opts: { body?: Blob | string; contentType?: string; authorization?: string } = {},
  ): Promise<TunnelResponse> {
    const tunnel = await this.ready();
    const channel = this.nextChannel++;
    const pending: PendingRequest = {
      resolve: () => {},
      reject: () => {},
      inFlight: 0,
      wake: null,
    };
    const done = new Promise<TunnelResponse>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.requests.set(channel, pending);
    const head = {
      method,
      path,
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
    };
    try {
      await tunnel.post(packChannel(CHANNEL.REQUEST, channel, JSON.stringify(head)));
      const body = typeof opts.body === 'string' ? new Blob([opts.body]) : opts.body;
      if (body) {
        for (let at = 0; at < body.size; at += BODY_CHUNK_BYTES) {
          // A few pieces in flight, so the relay never holds much of a large file.
          while (pending.inFlight >= BODY_WINDOW) {
            await new Promise<void>((r) => (pending.wake = r));
          }
          if (!this.requests.has(channel)) break; // answered early (too large) or lost
          const piece = new Uint8Array(await body.slice(at, at + BODY_CHUNK_BYTES).arrayBuffer());
          pending.inFlight++;
          await tunnel.post(packChannel(CHANNEL.DATA, channel, piece));
        }
      }
      await tunnel.post(packChannel(CHANNEL.END, channel));
    } catch (e) {
      this.requests.delete(channel);
      throw e instanceof Error ? e : new Error(String(e));
    }
    return done;
  }

  /** A WebSocket to a profile's stream server, through the tunnel. */
  socket(path: string): VirtualSocket {
    const channel = this.nextChannel++;
    const ws = new VirtualSocket(path, (kind, data) => {
      if (kind === CHANNEL.WS_CLOSE) this.sockets.delete(channel);
      this.tunnel?.post(packChannel(kind, channel, data)).catch(() => {});
    });
    this.sockets.set(channel, ws);
    this.ready()
      .then((t) => t.post(packChannel(CHANNEL.WS_OPEN, channel, JSON.stringify({ path }))))
      .catch(() => {
        this.sockets.delete(channel);
        ws.closed(1006, 'No connection to the PC.');
      });
    return ws;
  }

  // ---------------------------------------------------------------- the relay socket

  private setState(s: LinkState): void {
    this.state = s;
    if (s.kind === 'ready' || s.kind === 'revoked' || s.kind === 'failed') {
      for (const w of this.waiters.splice(0)) w();
    }
    this.onState(s);
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}${RELAY_API_PATH}/ws/phone`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    if (this.state.kind !== 'pc-offline') this.setState({ kind: 'connecting' });
    const send = (m: PhoneToRelay) =>
      ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    ws.onopen = () =>
      send({
        type: 'HELLO',
        deviceId: this.identity.deviceId,
        deviceKey: this.identity.deviceKey,
        version: VERSION,
      });
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data !== 'string') return this.onFrame(new Uint8Array(e.data as ArrayBuffer));
      const msg = JSON.parse(e.data) as RelayToPhone;
      switch (msg.type) {
        case 'WELCOME':
          this.retry = 0;
          if (msg.pc.online) send({ type: 'OPEN_SESSION' });
          else this.setState({ kind: 'pc-offline' });
          return;
        case 'PC_ONLINE':
          if (msg.online && !this.tunnel) send({ type: 'OPEN_SESSION' });
          if (!msg.online) {
            this.endSession(new Error(this.describe()));
            this.setState({ kind: 'pc-offline' });
          }
          return;
        case 'SESSION_GRANTED':
          void this.openSession(msg.sessionId, msg.iceServers);
          return;
        case 'SESSION_DENIED':
          this.setState({ kind: 'pc-offline' });
          return;
        case 'SESSION_CLOSED':
          this.endSession(new Error(msg.reason || 'The PC closed the connection.'));
          if (this.state.kind === 'ready') this.setState({ kind: 'connecting' });
          // The PC is still there: start a new session.
          window.setTimeout(() => this.ws === ws && send({ type: 'OPEN_SESSION' }), 1000);
          return;
        case 'REVOKED':
          this.setState({ kind: 'revoked' });
          return;
        case 'ERROR':
          this.setState({ kind: 'failed', message: msg.message });
          return;
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.endSession(new Error('Lost the connection to your PC. Reconnecting.'));
      if (e.code === RELAY_CLOSE.REVOKED) return this.setState({ kind: 'revoked' });
      if (this.stopped) return;
      if (this.state.kind !== 'pc-offline') this.setState({ kind: 'connecting' });
      const wait = BACKOFF_MS[Math.min(this.retry++, BACKOFF_MS.length - 1)]!;
      this.timer = window.setTimeout(() => this.connect(), wait);
    };
  }

  private async openSession(sessionId: string, iceServers: IceServer[]): Promise<void> {
    this.endSession(new Error('A new session started.'));
    const id = new Uint8Array(SESSION_ID_BYTES);
    for (let i = 0; i < SESSION_ID_BYTES; i++)
      id[i] = parseInt(sessionId.slice(i * 2, i * 2 + 2), 16);
    const ws = this.ws;
    const tunnel = new Tunnel(
      'phone',
      this.identity.keys,
      await importPublicKey(this.identity.pc.publicKey),
      (bytes) => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        const frame = new Uint8Array(1 + SESSION_ID_BYTES + bytes.length);
        frame[0] = TUNNEL_FRAME;
        frame.set(id, 1);
        frame.set(bytes, 1 + SESSION_ID_BYTES);
        ws.send(frame);
      },
    );
    tunnel.onMessage = (b) => this.onMessage(b);
    tunnel.onError = (e) => {
      this.endSession(e);
      this.setState({
        kind: 'failed',
        message: `The connection to your PC failed its security check. ${e.message}`,
      });
    };
    this.sessionId = id;
    this.tunnel = tunnel;
    for (const w of this.waiters.splice(0)) w();
    this.iceServers = iceServers;
    await tunnel.open();
    // A first message proves the keys both ways: the PC answers it.
    const probe = this.request('GET', '/v1/profiles').catch(() => null);
    tunnel.ready.then(
      () => this.tunnel === tunnel && this.setState({ kind: 'ready' }),
      () => {},
    );
    void probe;
  }

  private endSession(reason: Error): void {
    this.tunnel?.close();
    this.tunnel = null;
    this.sessionId = null;
    for (const r of this.requests.values()) r.reject(reason);
    this.requests.clear();
    for (const s of this.sockets.values()) s.closed(1006, reason.message);
    this.sockets.clear();
  }

  private onFrame(frame: Uint8Array): void {
    const id = this.sessionId;
    if (!id || !this.tunnel || frame[0] !== TUNNEL_FRAME) return;
    for (let i = 0; i < SESSION_ID_BYTES; i++) if (frame[1 + i] !== id[i]) return;
    this.tunnel.receive(frame.subarray(1 + SESSION_ID_BYTES));
  }

  private onMessage(bytes: Uint8Array): void {
    const { kind, channel, data } = unpackChannel(bytes);
    switch (kind) {
      case CHANNEL.RESPONSE: {
        const r = this.requests.get(channel);
        if (!r) return;
        this.requests.delete(channel);
        const { head, body } = unpackResponse(data);
        r.resolve({ status: head.status, contentType: head.contentType, body });
        r.wake?.();
        return;
      }
      case CHANNEL.ACK: {
        const r = this.requests.get(channel);
        if (!r) return;
        r.inFlight--;
        const w = r.wake;
        r.wake = null;
        w?.();
        return;
      }
      case CHANNEL.WS_OPENED:
        this.sockets.get(channel)?.opened();
        return;
      case CHANNEL.WS_TEXT:
        this.sockets.get(channel)?.message(textOf(data));
        return;
      case CHANNEL.WS_CLOSE: {
        const s = this.sockets.get(channel);
        this.sockets.delete(channel);
        const { code, reason } = JSON.parse(textOf(data)) as { code?: number; reason?: string };
        s?.closed(code ?? 1006, reason ?? '');
        return;
      }
    }
  }
}

/**
 * A WebSocket look-alike over the tunnel, for neko's client library (which uses `new
 * WebSocket`, `readyState`, `send`, `close` and the on* handlers).
 */
export class VirtualSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly protocol = '';
  readonly extensions = '';
  bufferedAmount = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(
    readonly url: string,
    private readonly post: (kind: number, data: string) => void,
  ) {}

  send(text: string): void {
    if (this.readyState !== 1) return;
    this.post(CHANNEL.WS_TEXT, String(text));
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.post(CHANNEL.WS_CLOSE, JSON.stringify({ code, reason }));
    this.closed(code, reason);
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  opened(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  message(data: string): void {
    if (this.readyState === 1) this.onmessage?.(new MessageEvent('message', { data }));
  }

  closed(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code: code === 1006 ? 1006 : code, reason }));
  }
}

// ------------------------------------------------------------------ hooks for neko's client

/** The address the app gives neko's client for a profile; requests to it go through the tunnel. */
export const TUNNEL_ORIGIN = 'https://pc.enclave.invalid';

/**
 * Sends neko's client library through the tunnel: its fetch and WebSocket calls to
 * TUNNEL_ORIGIN, and its WebRTC connection with the relay's STUN and TURN servers (neko gives
 * viewers none in relay mode).
 */
export function routeThroughTunnel(link: () => RelayLink | null): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const l = link();
    if (!url.startsWith(TUNNEL_ORIGIN) || !l) return realFetch(input, init);
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    const body = init?.body;
    const res = await l.request(init?.method ?? 'GET', u.pathname + u.search, {
      ...(typeof body === 'string' || body instanceof Blob ? { body } : {}),
      ...(headers.get('content-type') ? { contentType: headers.get('content-type')! } : {}),
      ...(headers.get('authorization') ? { authorization: headers.get('authorization')! } : {}),
    });
    return new Response(res.body.length ? (res.body as Uint8Array<ArrayBuffer>) : null, {
      status: res.status,
      headers: { 'Content-Type': res.contentType },
    });
  };

  const RealSocket = window.WebSocket;
  const tunnelOrigin = TUNNEL_ORIGIN.replace(/^http/, 'ws');
  const Socket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = String(url);
    const l = link();
    if (href.startsWith(tunnelOrigin) && l) {
      const u = new URL(href);
      return l.socket(u.pathname + u.search);
    }
    return new RealSocket(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Socket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Socket;

  const RealPeer = window.RTCPeerConnection;
  if (RealPeer) {
    const Peer = function (config?: RTCConfiguration) {
      const l = link();
      return new RealPeer(l ? { ...config, iceServers: l.iceServers } : config);
    } as unknown as typeof RTCPeerConnection;
    Peer.prototype = RealPeer.prototype;
    Object.assign(Peer, { generateCertificate: RealPeer.generateCertificate.bind(RealPeer) });
    window.RTCPeerConnection = Peer;
  }
}

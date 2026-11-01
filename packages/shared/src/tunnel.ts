// The end-to-end encrypted tunnel between a phone and its PC (Stage 6). The relay forwards
// the bytes but holds none of the keys, so it can't read or change what passes (profiles,
// requests, the stream's signaling, the phone's files).
//
// Keys: each side has a long-lived ECDH P-256 key, exchanged once at pairing and checked
// there with a secret only the QR code carries (pairingProof, pcKeyHash). Each connection
// adds a fresh ECDH key per side, so a key leaked later can't open recorded traffic.
//
//   ikm  = ECDH(phone eph, pc eph) || ECDH(phone static, pc static)
//   salt = phone nonce || pc nonce
//   info = "enclave-tunnel-v1" || phone static || pc static || phone eph || pc eph
//   HKDF-SHA256(ikm, salt, info) -> 64 bytes: phone-to-pc key, pc-to-phone key (AES-256-GCM)
//
// Each direction counts its messages; the counter is the GCM nonce and must go up by one, so
// a message can't be replayed, dropped or reordered unnoticed. Only the right static keys
// give the right session keys, so the first message that decrypts proves both sides.
//
// Uses only Web Crypto, so the same code runs in the phone's browser and in Node.

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ encoding

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]*$/.test(text)) throw new Error('Not base64url.');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// ------------------------------------------------------------------ keys

/** A new long-lived tunnel key. The private half can be kept non-extractable (phone). */
export async function generateTunnelKey(extractable: boolean): Promise<CryptoKeyPair> {
  return (await subtle().generateKey(ECDH, extractable, ['deriveBits'])) as CryptoKeyPair;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().exportKey('raw', key)));
}

export async function importPublicKey(raw: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(raw);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Not a P-256 public key.');
  return subtle().importKey('raw', bytes, ECDH, true, []);
}

/** The PC's private key, kept (sealed) as JWK on the PC. */
export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
  return subtle().exportKey('jwk', key);
}

export async function importKeyPair(jwk: JsonWebKey): Promise<CryptoKeyPair> {
  const privateKey = await subtle().importKey('jwk', jwk, ECDH, false, ['deriveBits']);
  const pub: JsonWebKey = { ...jwk };
  delete pub.d;
  const publicKey = await subtle().importKey('jwk', { ...pub, key_ops: [] }, ECDH, true, []);
  return { privateKey, publicKey };
}

async function ecdh(priv: CryptoKey, pub: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

// ------------------------------------------------------------------ pairing

/** The QR code's secret: never sent to the relay. */
export const PAIRING_SECRET_BYTES = 16;

/**
 * Proves to the PC that the phone key arriving through the relay is the one the phone that
 * scanned the QR code sent: only the QR code holds the secret. It covers the hash of the PC key
 * from the same QR code (`keyHash`), the only form of the PC key the phone has at that point.
 */
export async function pairingProof(
  secret: string,
  phoneKey: string,
  keyHash: string,
): Promise<string> {
  const data = enc.encode(`enclave-pair-v1\n${phoneKey}\n${keyHash}`);
  return toBase64Url(await hmac(fromBase64Url(secret), data));
}

export async function checkPairingProof(
  secret: string,
  phoneKey: string,
  keyHash: string,
  proof: string,
): Promise<boolean> {
  const want = fromBase64Url(await pairingProof(secret, phoneKey, keyHash));
  let given: Uint8Array;
  try {
    given = fromBase64Url(proof);
  } catch {
    return false;
  }
  return equalBytes(want, given);
}

/** A short hash of the PC's key for the QR code: the phone checks the key the relay hands it. */
export async function pcKeyHash(pcKey: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', fromBase64Url(pcKey)));
  return toBase64Url(digest.slice(0, 16));
}

/** What the QR code holds, after `#pair=` on the relay's address. */
export interface PairingLink {
  code: string;
  secret: string;
  pcKeyHash: string;
}

export function formatPairingLink(relayUrl: string, link: PairingLink): string {
  return `${relayUrl.replace(/\/+$/, '')}/#pair=${link.code}.${link.secret}.${link.pcKeyHash}`;
}

export function parsePairingFragment(hash: string): PairingLink | null {
  const m = /^#pair=([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(hash);
  return m ? { code: m[1]!, secret: m[2]!, pcKeyHash: m[3]! } : null;
}

// ------------------------------------------------------------------ the tunnel

export type TunnelRole = 'phone' | 'pc';

/** The handshake message each side sends first (in the clear: public keys and a nonce). */
interface Hello {
  v: 1;
  eph: string;
  nonce: string;
}

const PLAIN = 0;
const SEALED = 1;
const NONCE_BYTES = 16;
const INFO = 'enclave-tunnel-v1';
/** Room for one message in each direction: well beyond what a session sends. */
const MAX_COUNTER = 2 ** 48;

export class TunnelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelError';
  }
}

/**
 * One end of the tunnel for one session. `send` puts bytes on the wire (through the relay);
 * feed whatever arrives into `receive`. `onMessage` gets each decrypted message in order,
 * once both sides have proven their keys (`ready`).
 */
export class Tunnel {
  private eph: CryptoKeyPair | null = null;
  private myHello: Hello | null = null;
  private sendKey: CryptoKey | null = null;
  private receiveKey: CryptoKey | null = null;
  private sent = 0;
  private received = 0;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  /** Settles once a message from the other side has decrypted (both keys proven). */
  readonly ready: Promise<void>;
  onMessage: (data: Uint8Array) => void = () => {};
  onError: (e: Error) => void = () => {};

  constructor(
    private readonly role: TunnelRole,
    private readonly mine: CryptoKeyPair,
    private readonly theirs: CryptoKey,
    private readonly send: (bytes: Uint8Array) => void,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});
  }

  /** The phone starts; the PC answers the phone's hello with its own. */
  async open(): Promise<void> {
    this.eph = await generateTunnelKey(false);
    this.myHello = {
      v: 1,
      eph: await exportPublicKey(this.eph.publicKey),
      nonce: toBase64Url(randomBytes(NONCE_BYTES)),
    };
    this.send(concat(new Uint8Array([PLAIN]), enc.encode(JSON.stringify(this.myHello))));
  }

  receive(bytes: Uint8Array): void {
    // In order, one at a time: decryption is asynchronous and the counter must follow.
    this.queue = this.queue
      .then(() => this.handle(bytes))
      .catch((e: unknown) => this.fail(e instanceof Error ? e : new Error(String(e))));
  }

  /** Encrypts and sends one message. Waits for the handshake if it is still running. */
  post(data: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new TunnelError('The tunnel is closed.'));
    // In order, one at a time: the receiver expects the counters in sequence.
    const sending = this.sending.then(async () => {
      if (!this.sendKey) await this.keysReady;
      if (this.closed) return;
      if (this.sent >= MAX_COUNTER) throw new TunnelError('The tunnel has run out of messages.');
      const iv = counterIv(this.sent++);
      const sealed = new Uint8Array(
        await subtle().encrypt(
          { name: 'AES-GCM', iv },
          this.sendKey!,
          data as Uint8Array<ArrayBuffer>,
        ),
      );
      if (!this.closed) this.send(concat(new Uint8Array([SEALED]), sealed));
    });
    this.sending = sending.catch(() => {});
    return sending;
  }

  private sending: Promise<void> = Promise.resolve();

  close(): void {
    this.closed = true;
    this.rejectReady(new TunnelError('The tunnel closed before it was ready.'));
  }

  // Resolves when this side has its session keys (the other side may not have proven itself yet).
  private resolveKeys!: () => void;
  private readonly keysReady = new Promise<void>((resolve) => (this.resolveKeys = resolve));

  private async handle(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    const kind = bytes[0];
    const body = bytes.subarray(1);
    if (kind === PLAIN) {
      if (this.receiveKey) throw new TunnelError('A second handshake in one session.');
      let hello: Hello;
      try {
        hello = JSON.parse(dec.decode(body)) as Hello;
      } catch {
        throw new TunnelError('The handshake was not readable.');
      }
      if (hello.v !== 1 || typeof hello.eph !== 'string' || typeof hello.nonce !== 'string') {
        throw new TunnelError('The other side speaks another tunnel version.');
      }
      if (this.role === 'pc') await this.open();
      else if (!this.myHello) throw new TunnelError('The PC answered before the phone asked.');
      await this.derive(hello);
      return;
    }
    if (kind !== SEALED || !this.receiveKey) throw new TunnelError('Unexpected tunnel data.');
    const iv = counterIv(this.received++);
    let plain: Uint8Array;
    try {
      plain = new Uint8Array(
        await subtle().decrypt(
          { name: 'AES-GCM', iv },
          this.receiveKey,
          body as Uint8Array<ArrayBuffer>,
        ),
      );
    } catch {
      throw new TunnelError(
        'A tunnel message failed its check: wrong keys, or it was changed on the way.',
      );
    }
    this.resolveReady();
    if (!this.closed) this.onMessage(plain);
  }

  private async derive(theirHello: Hello): Promise<void> {
    const eph = this.eph!;
    const mine = this.myHello!;
    const theirEph = await importPublicKey(theirHello.eph);
    const myStatic = await exportPublicKey(this.mine.publicKey);
    const theirStatic = await exportPublicKey(this.theirs);
    const ikm = concat(
      await ecdh(eph.privateKey, theirEph),
      await ecdh(this.mine.privateKey, this.theirs),
    );
    const phone = this.role === 'phone';
    const [phoneHello, pcHello] = phone ? [mine, theirHello] : [theirHello, mine];
    const [phoneStatic, pcStatic] = phone ? [myStatic, theirStatic] : [theirStatic, myStatic];
    const salt = concat(fromBase64Url(phoneHello.nonce), fromBase64Url(pcHello.nonce));
    const info = enc.encode([INFO, phoneStatic, pcStatic, phoneHello.eph, pcHello.eph].join('\n'));
    const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const okm = new Uint8Array(
      await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, 512),
    );
    const aes = (raw: Uint8Array<ArrayBuffer>) =>
      subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const phoneToPc = await aes(okm.slice(0, 32));
    const pcToPhone = await aes(okm.slice(32, 64));
    this.sendKey = phone ? phoneToPc : pcToPhone;
    this.receiveKey = phone ? pcToPhone : phoneToPc;
    this.resolveKeys();
  }

  private fail(e: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectReady(e);
    this.onError(e);
  }
}

function counterIv(n: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(4, Math.floor(n / 2 ** 32));
  view.setUint32(8, n >>> 0);
  return iv;
}

// ------------------------------------------------------------------ what travels inside

/**
 * Messages inside the tunnel: [kind, 1 byte][channel, 4 bytes][data]. The phone opens
 * channels; each is one request or one WebSocket.
 *
 * Paths: `/v1/...` is the agent's API (only what the phone app needs); `/neko/<profile id>/...`
 * is that running profile's stream server.
 */
export const CHANNEL = {
  /** phone -> pc: JSON { method, path, contentType? }; the body follows as DATA, then END. */
  REQUEST: 1,
  /** phone -> pc: a piece of a request body (at most BODY_CHUNK_BYTES). */
  DATA: 2,
  /** phone -> pc: the request body is complete. */
  END: 3,
  /** pc -> phone: JSON { status, contentType } then the body, as [head length, 4 bytes][head][body]. */
  RESPONSE: 4,
  /** pc -> phone: one DATA piece was taken (flow control: few pieces in flight). */
  ACK: 5,
  /** phone -> pc: JSON { path }: open a WebSocket to it. */
  WS_OPEN: 6,
  /** pc -> phone: the WebSocket is open. */
  WS_OPENED: 7,
  /** both ways: one WebSocket text message. */
  WS_TEXT: 8,
  /** both ways: JSON { code, reason }: the WebSocket closed. */
  WS_CLOSE: 9,
} as const;

export const BODY_CHUNK_BYTES = 256 * 1024;
/** Body pieces the phone sends before waiting for the PC to take one. */
export const BODY_WINDOW = 8;

export interface ChannelMessage {
  kind: number;
  channel: number;
  data: Uint8Array;
}

export function packChannel(
  kind: number,
  channel: number,
  data: Uint8Array | string = '',
): Uint8Array {
  const body = typeof data === 'string' ? enc.encode(data) : data;
  const out = new Uint8Array(5 + body.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, channel);
  out.set(body, 5);
  return out;
}

export function unpackChannel(bytes: Uint8Array): ChannelMessage {
  if (bytes.length < 5) throw new TunnelError('A tunnel message was too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { kind: bytes[0]!, channel: view.getUint32(1), data: bytes.subarray(5) };
}

export function packResponse(
  head: { status: number; contentType: string },
  body: Uint8Array | string,
): Uint8Array {
  const h = enc.encode(JSON.stringify(head));
  const b = typeof body === 'string' ? enc.encode(body) : body;
  const out = new Uint8Array(4 + h.length + b.length);
  new DataView(out.buffer).setUint32(0, h.length);
  out.set(h, 4);
  out.set(b, 4 + h.length);
  return out;
}

export function unpackResponse(data: Uint8Array): {
  head: { status: number; contentType: string };
  body: Uint8Array;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = view.getUint32(0);
  return {
    head: JSON.parse(dec.decode(data.subarray(4, 4 + n))) as {
      status: number;
      contentType: string;
    },
    body: data.subarray(4 + n),
  };
}

export const textOf = (data: Uint8Array): string => dec.decode(data);

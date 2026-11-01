// The PC's side of one phone session through the relay (Stage 6). The tunnel (shared
// tunnel.ts) is already decrypting; this answers what arrives inside it: the few agent API
// calls the phone app makes, and the running profiles' stream servers (neko's API and its
// WebSocket). Nothing else on the PC can be reached this way, and of the profiles only the
// ones this phone may open (its PhoneProfiles): others are left out of the list and refused
// as if they didn't exist.

import {
  BODY_CHUNK_BYTES,
  CHANNEL,
  MAX_PHONE_FILE_BYTES,
  packChannel,
  packResponse,
  textOf,
  unpackChannel,
  type PhoneProfiles,
  type Profile,
  type Tunnel,
} from '@enclave/shared';

/** What a session needs from the agent. */
export interface TunnelBackend {
  /** One request to the agent's own API (Fastify inject, with the agent token added). */
  inject(req: {
    method: string;
    url: string;
    contentType: string | undefined;
    body: Buffer | undefined;
  }): Promise<{ status: number; contentType: string; body: Buffer }>;
  /** The stream server port of a running profile; throws if it isn't running. */
  streamPort(profileId: string): Promise<number>;
}

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The agent API calls the phone app makes; nothing else is reachable through the relay. */
const AGENT_ROUTES: [string, RegExp][] = [
  ['GET', /^\/v1\/profiles$/],
  ['POST', new RegExp(`^/v1/profiles/${ID}/(start|stop)$`)],
  ['GET', new RegExp(`^/v1/profiles/${ID}/(stream|media)$`)],
  ['POST', new RegExp(`^/v1/profiles/${ID}/files\\?name=[^&#]*$`)],
];
/** The profile an agent API path is about, if any. */
const PROFILE_PATH = new RegExp(`^/v1/profiles/(${ID})/`);
const NEKO_HTTP = new RegExp(`^/neko/(${ID})(/api/[\\w/-]*)$`);
const NEKO_WS = new RegExp(`^/neko/(${ID})/api/ws(\\?token=[\\w%.-]+)?$`);

const SMALL_BODY_BYTES = 64 * 1024;
const NOT_SHARED = 'This profile is not shared with this phone.';

interface RequestChannel {
  type: 'request';
  method: string;
  path: string;
  contentType: string | undefined;
  authorization: string | undefined;
  limit: number;
  chunks: Buffer[];
  size: number;
}

interface SocketChannel {
  type: 'socket';
  profileId: string;
  ws: WebSocket;
  /** Messages from the phone that arrived before the stream server answered. */
  waiting: string[];
}

export class TunnelSession {
  private readonly channels = new Map<number, RequestChannel | SocketChannel>();
  private closed = false;

  constructor(
    private readonly tunnel: Tunnel,
    private readonly backend: TunnelBackend,
    private readonly onFail: (reason: string) => void,
    /** Which profiles this phone may open, read at every request (changes apply at once). */
    private readonly scope: () => PhoneProfiles = () => 'all',
  ) {
    tunnel.onMessage = (bytes) => {
      try {
        this.handle(bytes);
      } catch (e) {
        this.fail(e instanceof Error ? e.message : String(e));
      }
    };
    tunnel.onError = (e) => this.fail(e.message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tunnel.close();
    for (const ch of this.channels.values()) if (ch.type === 'socket') ch.ws.close(1000);
    this.channels.clear();
  }

  private allowed(profileId: string): boolean {
    const scope = this.scope();
    return scope === 'all' || scope.includes(profileId);
  }

  /** Closes the streams of profiles this phone may no longer open (after a change). */
  enforce(): void {
    for (const [channel, ch] of this.channels) {
      if (ch.type !== 'socket' || this.allowed(ch.profileId)) continue;
      this.channels.delete(channel);
      ch.ws.close(1000);
      this.post(CHANNEL.WS_CLOSE, channel, JSON.stringify({ code: 4403, reason: NOT_SHARED }));
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onFail(reason);
  }

  private post(kind: number, channel: number, data: Uint8Array | string = ''): void {
    if (this.closed) return;
    this.tunnel.post(packChannel(kind, channel, data)).catch(() => {});
  }

  private handle(bytes: Uint8Array): void {
    const { kind, channel, data } = unpackChannel(bytes);
    const ch = this.channels.get(channel);
    switch (kind) {
      case CHANNEL.REQUEST: {
        if (ch) throw new Error('A channel was opened twice.');
        const head = JSON.parse(textOf(data)) as {
          method?: unknown;
          path?: unknown;
          contentType?: unknown;
          authorization?: unknown;
        };
        const method = String(head.method ?? '').toUpperCase();
        const path = String(head.path ?? '');
        const isFile = method === 'POST' && /\/files\?/.test(path);
        this.channels.set(channel, {
          type: 'request',
          method,
          path,
          contentType: typeof head.contentType === 'string' ? head.contentType : undefined,
          authorization: typeof head.authorization === 'string' ? head.authorization : undefined,
          limit: isFile ? MAX_PHONE_FILE_BYTES : SMALL_BODY_BYTES,
          chunks: [],
          size: 0,
        });
        return;
      }
      case CHANNEL.DATA: {
        if (ch?.type !== 'request') throw new Error('Body data for no request.');
        if (data.length > BODY_CHUNK_BYTES) throw new Error('A body piece was too large.');
        ch.size += data.length;
        if (ch.size > ch.limit) {
          this.channels.delete(channel);
          this.respond(channel, 413, { error: { code: 'BAD_REQUEST', message: 'Too large.' } });
          return;
        }
        ch.chunks.push(Buffer.from(data));
        this.post(CHANNEL.ACK, channel);
        return;
      }
      case CHANNEL.END: {
        if (ch?.type !== 'request') return; // already answered (too large)
        this.channels.delete(channel);
        void this.dispatch(channel, ch);
        return;
      }
      case CHANNEL.WS_OPEN: {
        if (ch) throw new Error('A channel was opened twice.');
        const { path } = JSON.parse(textOf(data)) as { path?: unknown };
        void this.openSocket(channel, String(path ?? ''));
        return;
      }
      case CHANNEL.WS_TEXT: {
        if (ch?.type !== 'socket') return;
        const text = textOf(data);
        if (ch.ws.readyState === WebSocket.OPEN) ch.ws.send(text);
        else ch.waiting.push(text);
        return;
      }
      case CHANNEL.WS_CLOSE: {
        if (ch?.type !== 'socket') return;
        this.channels.delete(channel);
        ch.ws.close(1000);
        return;
      }
      default:
        throw new Error(`Unknown tunnel message ${kind}.`);
    }
  }

  private respond(
    channel: number,
    status: number,
    body: unknown,
    contentType = 'application/json',
  ) {
    const bytes =
      body instanceof Uint8Array ? body : typeof body === 'string' ? body : JSON.stringify(body);
    this.post(CHANNEL.RESPONSE, channel, packResponse({ status, contentType }, bytes));
  }

  private async dispatch(channel: number, req: RequestChannel): Promise<void> {
    const body = req.chunks.length ? Buffer.concat(req.chunks) : undefined;
    try {
      if (AGENT_ROUTES.some(([m, re]) => m === req.method && re.test(req.path))) {
        const about = PROFILE_PATH.exec(req.path)?.[1];
        if (about && !this.allowed(about)) {
          return this.respond(channel, 404, {
            error: { code: 'PROFILE_NOT_FOUND', message: 'No such profile on this PC.' },
          });
        }
        const res = await this.backend.inject({
          method: req.method,
          url: req.path,
          contentType: req.contentType,
          body,
        });
        let out = new Uint8Array(res.body);
        // The list: only the profiles this phone may open.
        if (!about && res.status === 200 && this.scope() !== 'all') {
          const list = JSON.parse(res.body.toString('utf8')) as Profile[];
          out = new TextEncoder().encode(JSON.stringify(list.filter((p) => this.allowed(p.id))));
        }
        return this.respond(channel, res.status, out, res.contentType);
      }
      const neko = NEKO_HTTP.exec(req.path);
      if (neko && !this.allowed(neko[1]!)) {
        // 401: neko's client takes it as the end of the session and stops retrying.
        return this.respond(channel, 401, { message: NOT_SHARED });
      }
      if (neko && (req.method === 'GET' || req.method === 'POST')) {
        const port = await this.backend.streamPort(neko[1]!);
        const res = await fetch(`http://127.0.0.1:${port}${neko[2]}`, {
          method: req.method,
          headers: {
            ...(req.contentType ? { 'Content-Type': req.contentType } : {}),
            ...(req.authorization ? { Authorization: req.authorization } : {}),
          },
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(15_000),
        });
        return this.respond(
          channel,
          res.status,
          new Uint8Array(await res.arrayBuffer()),
          res.headers.get('content-type') ?? 'application/octet-stream',
        );
      }
      this.respond(channel, 404, {
        error: { code: 'NOT_FOUND', message: 'Not available from the phone.' },
      });
    } catch (e) {
      const err = e as { status?: number; toJSON?: () => unknown; message?: string };
      if (typeof err.toJSON === 'function' && err.status) {
        return this.respond(channel, err.status, err.toJSON());
      }
      this.respond(channel, 502, {
        error: { code: 'INTERNAL', message: err.message ?? 'The PC could not answer.' },
      });
    }
  }

  private async openSocket(channel: number, path: string): Promise<void> {
    const m = NEKO_WS.exec(path);
    const closeWith = (code: number, reason: string) =>
      this.post(CHANNEL.WS_CLOSE, channel, JSON.stringify({ code, reason }));
    if (!m) return closeWith(4404, 'Not available from the phone.');
    if (!this.allowed(m[1]!)) return closeWith(4403, NOT_SHARED);
    let port: number;
    try {
      port = await this.backend.streamPort(m[1]!);
    } catch (e) {
      return closeWith(4409, e instanceof Error ? e.message : 'The profile is not running.');
    }
    if (this.closed) return;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws${m[2] ?? ''}`);
    const ch: SocketChannel = { type: 'socket', profileId: m[1]!, ws, waiting: [] };
    this.channels.set(channel, ch);
    ws.onopen = () => {
      this.post(CHANNEL.WS_OPENED, channel);
      for (const text of ch.waiting.splice(0)) ws.send(text);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.post(CHANNEL.WS_TEXT, channel, e.data);
    };
    ws.onclose = (e) => {
      if (this.channels.get(channel) !== ch) return;
      this.channels.delete(channel);
      closeWith(e.code === 1005 ? 1000 : e.code, e.reason);
    };
    ws.onerror = () => {};
  }
}

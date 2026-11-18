// The relay's HTTP API (specs/relay-protocol.md), its WebSockets, and the phone app's files.

import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocketServer } from 'ws';
import {
  PAIRING_TTL_MS,
  RELAY_API_PATH,
  type ClaimPairingRequest,
  type ClaimPairingResponse,
  type CreateAccountRequest,
  type CreatePairingResponse,
  type RegisterPcRequest,
  type RegisterPcResponse,
  type RelayDevice,
  type LicenseCheckRequest,
  type LicenseCheckResponse,
  type RelayInfo,
} from '@enclave/shared';
import type { RelayConfig } from './config.js';
import { Hub } from './hub.js';
import { checkLicense } from './license.js';
import { RateLimit } from './rate-limit.js';
import { RelayStore, secretMatches, verifyNothing, verifyPassword, type Pc } from './store.js';

export const RELAY_VERSION = '0.1.0';

/** Tunnel frames are at most a 256 KB body piece plus headers. */
const MAX_WS_MESSAGE_BYTES = 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Relay {
  app: FastifyInstance;
  hub: Hub;
  store: RelayStore;
  close(): Promise<void>;
}

export async function buildRelay(config: RelayConfig): Promise<Relay> {
  const store = new RelayStore(config.dataDir);
  await store.load();
  const hub = new Hub(store, config);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: config.trustProxy });
  const limits = {
    // Password checks: 10 per 10 minutes from one address.
    password: new RateLimit(10, 10 * 60_000),
    // Pairing claims: 20 per 10 minutes.
    claim: new RateLimit(20, 10 * 60_000),
    // License checks: 60 per 10 minutes from one address (the app checks once a day).
    license: new RateLimit(60, 10 * 60_000),
  };

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (!req.url.startsWith(RELAY_API_PATH)) {
      // The phone app: its own files and the relay only. Media (blob:) is the camera preview.
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
    }
  });

  app.setErrorHandler(async (thrown, _req, reply) => {
    if (thrown instanceof HttpError) {
      return reply
        .code(thrown.status)
        .send({ error: { code: thrown.code, message: thrown.message } });
    }
    const err = thrown as Error & { statusCode?: number; validation?: unknown };
    if (err.validation || (err.statusCode && err.statusCode < 500)) {
      return reply
        .code(err.statusCode ?? 400)
        .send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'Something went wrong on the relay.' } });
  });

  /** The PC's credential: `Authorization: Bearer <pc id>.<pc secret>`. */
  const pcAuth = (req: FastifyRequest): Pc => {
    const m = /^Bearer ([\w-]+)\.([\w-]+)$/.exec(req.headers.authorization ?? '');
    const pc = m ? store.pc(m[1]!) : undefined;
    if (!pc || !secretMatches(m![2]!, pc.secretHash)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'This PC is not signed in to the relay.');
    }
    return pc;
  };

  app.register(
    async (r) => {
      r.get('/info', async (): Promise<RelayInfo> => ({
        name: 'enclave-relay',
        version: RELAY_VERSION,
        signup: config.signup,
      }));

      r.post<{ Body: CreateAccountRequest }>(
        '/accounts',
        { schema: { body: accountSchema(true) } },
        async (req, reply) => {
          limits.password.take(req.ip);
          if (config.signup === 'closed') {
            throw new HttpError(
              403,
              'SIGNUP_CLOSED',
              "This relay isn't taking new accounts. If you already have one, untick Make a new account with this email and sign in.",
            );
          }
          const email = req.body.email.trim().toLowerCase();
          if (store.accountByEmail(email)) {
            throw new HttpError(
              409,
              'ACCOUNT_EXISTS',
              'There is already an account with this email. Untick Make a new account with this email and sign in.',
            );
          }
          if (config.signup === 'invite') {
            const code = (req.body.inviteCode ?? '').trim();
            // The relay's own code (RELAY_INVITE_CODE), or a single-use one (used up here).
            const ok =
              (config.inviteCode !== undefined && sameText(code, config.inviteCode)) ||
              (code !== '' && (await store.useInvite(code, email)));
            if (!ok) {
              throw new HttpError(
                403,
                'INVITE_REQUIRED',
                'The invite code is not right, or it was already used.',
              );
            }
          }
          await store.addAccount(email, req.body.password);
          return reply.code(201).send({ ok: true });
        },
      );

      r.post<{ Body: RegisterPcRequest }>(
        '/pcs',
        { schema: { body: registerSchema } },
        async (req, reply): Promise<RegisterPcResponse> => {
          limits.password.take(req.ip);
          const account = store.accountByEmail(req.body.email.trim().toLowerCase());
          const ok = account
            ? await verifyPassword(req.body.password, account.passwordHash)
            : await verifyNothing(req.body.password);
          if (!account || !ok) {
            throw new HttpError(401, 'SIGN_IN_FAILED', 'The email or password is not right.');
          }
          const { pc, secret } = await store.addPc(
            account.id,
            req.body.name.trim(),
            req.body.publicKey,
          );
          reply.code(201);
          return { pcId: pc.id, pcSecret: secret };
        },
      );

      r.delete('/pcs/self', async (req) => {
        const pc = pcAuth(req);
        hub.removePc(pc.id, await store.removePc(pc.id));
        return { ok: true };
      });

      r.post('/pairings', async (req, reply): Promise<CreatePairingResponse> => {
        const pc = pcAuth(req);
        if (!hub.isOnline(pc.id)) {
          throw new HttpError(409, 'PC_OFFLINE', 'Connect this PC to the relay first.');
        }
        const { code, expiresAt } = hub.createPairing(pc.id, PAIRING_TTL_MS);
        reply.code(201);
        return { code, expiresAt: new Date(expiresAt).toISOString() };
      });

      r.post<{ Body: ClaimPairingRequest }>(
        '/pairings/claim',
        { schema: { body: claimSchema } },
        async (req): Promise<ClaimPairingResponse> => {
          limits.claim.take(req.ip);
          const expired = new HttpError(
            410,
            'PAIRING_EXPIRED',
            'This QR code has expired or was already used. Show a new one on the PC.',
          );
          const pcId = hub.takePairing(req.body.code);
          const pc = pcId ? store.pc(pcId) : undefined;
          if (!pc) throw expired;
          const name = req.body.deviceName.trim();
          // The device is saved only once the PC has checked the proof with the QR's secret.
          const { device, key } = await store.addDevice(pc.id, name);
          const ok = await hub.askPc(pc.id, {
            code: req.body.code,
            deviceId: device.id,
            deviceName: name,
            publicKey: req.body.publicKey,
            proof: req.body.proof,
          });
          if (!ok) {
            await store.removeDevice(device.id);
            throw new HttpError(
              403,
              'PAIRING_REFUSED',
              'Your PC did not accept this phone. Show a new QR code on the PC and scan it again.',
            );
          }
          return {
            deviceId: device.id,
            deviceKey: key,
            pc: { id: pc.id, name: pc.name, publicKey: pc.publicKey },
          };
        },
      );

      // Invites, for the relay's owner only: from inside the relay's own container
      // (node /app/relay.mjs invite <note>), never through Caddy.
      const ownerOnly = (req: FastifyRequest) => {
        const from = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(from)) {
          throw new HttpError(404, 'NOT_FOUND', 'Not found.');
        }
      };
      r.post<{ Body: { note?: string } }>('/admin/invites', async (req, reply) => {
        ownerOnly(req);
        const note = String(req.body?.note ?? '').slice(0, 100);
        const { code, invite } = await store.addInvite(note);
        reply.code(201);
        return { code, id: invite.id, note: invite.note };
      });
      r.get('/admin/invites', async (req) => {
        ownerOnly(req);
        return store.invites().map((i) => ({
          id: i.id,
          note: i.note,
          createdAt: i.createdAt,
          usedAt: i.usedAt,
          usedBy: i.usedBy,
        }));
      });

      r.post<{ Body: LicenseCheckRequest }>(
        '/license/check',
        {
          schema: {
            body: {
              type: 'object',
              required: ['key', 'pc'],
              additionalProperties: false,
              properties: {
                key: { type: 'string', minLength: 10, maxLength: 1000 },
                pc: { type: 'string', pattern: '^[0-9a-f]{64}$' },
              },
            },
          },
        },
        async (req): Promise<LicenseCheckResponse> => {
          limits.license.take(req.ip);
          return checkLicense(store, req.body.key, req.body.pc);
        },
      );
      r.get('/admin/licenses', async (req) => {
        ownerOnly(req);
        return store.licenses();
      });
      r.post<{ Params: { id: string; action: string } }>(
        '/admin/licenses/:id/:action',
        async (req) => {
          ownerOnly(req);
          const { id, action } = req.params;
          if (action !== 'revoke' && action !== 'unrevoke' && action !== 'reset-pc') {
            throw new HttpError(404, 'NOT_FOUND', 'Not found.');
          }
          if (!(await store.setLicense(id, action))) {
            throw new HttpError(404, 'NOT_FOUND', 'No license with that id has been used yet.');
          }
          return { ok: true };
        },
      );

      r.get('/devices', async (req): Promise<RelayDevice[]> => {
        const pc = pcAuth(req);
        return store.devicesOf(pc.id).map((d) => ({
          id: d.id,
          name: d.name,
          pairedAt: d.createdAt,
          lastSeenAt: d.lastSeenAt,
        }));
      });

      r.delete<{ Params: { id: string } }>('/devices/:id', async (req) => {
        const pc = pcAuth(req);
        const d = store.device(req.params.id);
        if (!d || d.pcId !== pc.id) {
          throw new HttpError(404, 'NOT_FOUND', 'This phone is not paired with this PC.');
        }
        await store.removeDevice(d.id);
        hub.revoke(d.id);
        return { ok: true };
      });
    },
    { prefix: RELAY_API_PATH },
  );

  // The phone app.
  const root = path.resolve(config.staticDir);
  app.get('/*', async (req, reply) => serveFile(root, req, reply));

  // WebSockets: PCs and phones. Only the phone app's own page may open one from a browser.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });
  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    const kind =
      url.pathname === `${RELAY_API_PATH}/ws/pc`
        ? 'pc'
        : url.pathname === `${RELAY_API_PATH}/ws/phone`
          ? 'phone'
          : null;
    const origin = req.headers.origin;
    if (!kind || (origin !== undefined && new URL(origin).host !== req.headers.host)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      kind === 'pc' ? hub.acceptPc(ws) : hub.acceptPhone(ws),
    );
  });

  return {
    app,
    hub,
    store,
    close: async () => {
      hub.close();
      wss.close();
      await app.close();
      await store.save();
    },
  };
}

async function serveFile(root: string, req: FastifyRequest, reply: FastifyReply) {
  const rel = decodeURIComponent(new URL(req.url, 'http://relay').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, rel || 'index.html');
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(root + path.sep) || !type) {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
  try {
    const body = await readFile(file);
    // The app and its service worker must always be the newest; the icons may be kept.
    reply.header('Cache-Control', type.startsWith('image/') ? 'max-age=86400' : 'no-cache');
    return reply.type(type).send(body);
  } catch {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const KEY = { type: 'string', pattern: '^[A-Za-z0-9_-]{87}$' } as const; // 65 bytes, base64url

function accountSchema(withInvite: boolean) {
  return {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+$' },
      password: { type: 'string', minLength: 10, maxLength: 200 },
      ...(withInvite ? { inviteCode: { type: 'string', maxLength: 200 } } : {}),
    },
  } as const;
}

const registerSchema = {
  type: 'object',
  required: ['email', 'password', 'name', 'publicKey'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 60 },
    publicKey: KEY,
  },
} as const;

const claimSchema = {
  type: 'object',
  required: ['code', 'deviceName', 'publicKey', 'proof'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
    deviceName: { type: 'string', minLength: 1, maxLength: 60 },
    publicKey: KEY,
    proof: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  },
} as const;

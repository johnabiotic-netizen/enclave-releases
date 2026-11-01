// The local API (specs/agent-api.md). Binds 127.0.0.1 only and requires the bearer token.
// It also serves the phone app's files (packages/mobile), which hold no secrets: the app asks
// for the token itself and sends it on every API call.

import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  API_BASE_PATH,
  type CheckNewProxyRequest,
  type CreateProfileRequest,
  type HealthResponse,
  MAX_PHONE_FILE_BYTES,
  type RelayPairingRequest,
  type RelaySignInRequest,
  type UpdatePairedPhoneRequest,
  type UpdateProfileRequest,
} from '@enclave/shared';
import { AgentError, InputError } from './errors.js';
import type { ProfileService, ProxyTestRequest } from './profiles.js';
import type { DockerRuntime } from './docker/runtime.js';
import type { RelayLink } from './relay/link.js';

export const AGENT_VERSION = '0.1.0';
const LOOPBACK = '127.0.0.1';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function buildServer(
  token: string,
  service: ProfileService,
  runtime: DockerRuntime,
  mobileDir?: string,
  relay?: RelayLink,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const expected = Buffer.from(`Bearer ${token}`);

  app.addHook('onRequest', async (req, reply) => {
    // Only the phone app's static files go without the token. Decided by the route that
    // matched, not the raw URL, so an encoded path can't reach the API around the check.
    if (mobileDir && req.routeOptions.url === '/*') return;
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Missing or wrong agent token.' } });
    }
  });

  // Files from the phone arrive raw; JSON bodies keep the small limit above.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_PHONE_FILE_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.setErrorHandler(async (thrown, _req, reply) => {
    const err = thrown instanceof Error ? thrown : new Error(String(thrown));
    if (err instanceof AgentError) return reply.code(err.status).send(err.toJSON());
    if (err instanceof InputError || (err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    return reply.code(500).send(new AgentError('INTERNAL', err.message).toJSON());
  });

  app.register(
    async (v1) => {
      v1.get('/health', async (): Promise<HealthResponse> => ({
        ok: true,
        version: AGENT_VERSION,
        dockerOk: await runtime.ping(),
      }));
      v1.get('/system', async () => service.system());

      v1.get('/profiles', async () => service.list());
      v1.post<{ Body: CreateProfileRequest }>('/profiles', async (req, reply) => {
        reply.code(201);
        return service.create(req.body ?? ({} as CreateProfileRequest));
      });
      v1.get<{ Params: { id: string } }>('/profiles/:id', async (req) =>
        service.get(req.params.id),
      );
      v1.patch<{ Params: { id: string }; Body: UpdateProfileRequest }>(
        '/profiles/:id',
        async (req) => service.update(req.params.id, req.body ?? {}),
      );
      v1.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>(
        '/profiles/:id',
        async (req) => {
          await service.delete(req.params.id, req.query.confirm === 'true');
          return { ok: true };
        },
      );

      v1.post<{ Params: { id: string } }>('/profiles/:id/start', async (req) =>
        service.start(req.params.id),
      );
      v1.post<{ Params: { id: string } }>('/profiles/:id/stop', async (req) => {
        await service.stop(req.params.id);
        return { ok: true };
      });
      v1.get<{ Params: { id: string } }>('/profiles/:id/stream', async (req) =>
        service.stream(req.params.id),
      );
      // Stage 4: the phone asks while it shows the profile, to offer its camera and mic.
      v1.get<{ Params: { id: string } }>('/profiles/:id/media', async (req) =>
        service.media(req.params.id),
      );
      // Downloads: what the profile saved, to take to the phone or the PC.
      v1.get<{ Params: { id: string } }>('/profiles/:id/downloads', async (req) =>
        service.downloads(req.params.id),
      );
      v1.get<{ Params: { id: string; name: string } }>(
        '/profiles/:id/downloads/:name',
        async (req, reply) => {
          const { data } = await service.download(req.params.id, req.params.name);
          return reply
            .type('application/octet-stream')
            .header(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(req.params.name)}`,
            )
            .send(data);
        },
      );
      // Stage 4: a file from the phone into the profile's open file picker.
      v1.post<{ Params: { id: string }; Querystring: { name?: string }; Body: Buffer }>(
        '/profiles/:id/files',
        { bodyLimit: MAX_PHONE_FILE_BYTES },
        async (req) => {
          if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            throw new InputError('Send the file as the request body (application/octet-stream).');
          }
          await service.sendFile(req.params.id, String(req.query.name ?? ''), req.body);
          return { ok: true };
        },
      );
      v1.post<{ Params: { id: string } }>('/profiles/:id/update-location', async (req) =>
        service.updateLocation(req.params.id),
      );
      v1.post<{ Body: CheckNewProxyRequest }>('/proxy-check', async (req) =>
        service.checkNewProxy(req.body ?? {}),
      );
      v1.post<{ Params: { id: string } }>('/profiles/:id/check-proxy', async (req) =>
        service.checkProfileProxy(req.params.id),
      );
      // Audit (testing/test-suite.md): starts in the background, then poll the job.
      v1.post<{ Params: { id: string }; Body: { checks?: string[]; saveBaseline?: boolean } }>(
        '/profiles/:id/audit',
        async (req, reply) => {
          await service.get(req.params.id);
          const checks = Array.isArray(req.body?.checks) ? req.body.checks.map(String) : [];
          reply.code(202);
          return service.startAudit(req.params.id, checks, {
            saveBaseline: req.body?.saveBaseline === true,
          });
        },
      );
      v1.get<{ Params: { jobId: string } }>('/audits/:jobId', async (req) =>
        service.auditJob(req.params.jobId),
      );
      // Proxy tester: starts in the background, then poll the job.
      v1.post<{ Body: ProxyTestRequest }>('/proxy-tests', async (req, reply) => {
        const job = await service.startProxyTest(req.body ?? {});
        reply.code(202);
        return job;
      });
      v1.get<{ Params: { jobId: string } }>('/proxy-tests/:jobId', async (req) =>
        service.proxyTestJob(req.params.jobId),
      );
      // Stage 6: phone linking through the relay.
      if (relay) {
        v1.get('/relay', async () => relay.status());
        v1.post<{ Body: RelaySignInRequest }>('/relay/sign-in', async (req) =>
          relay.signIn(req.body ?? ({} as RelaySignInRequest)),
        );
        v1.post('/relay/sign-out', async () => {
          await relay.signOut();
          return { ok: true };
        });
        v1.post<{ Body: RelayPairingRequest }>('/relay/pairing', async (req) =>
          relay.pairing(req.body ?? { profiles: [] }),
        );
        v1.patch<{ Params: { id: string }; Body: UpdatePairedPhoneRequest }>(
          '/relay/devices/:id',
          async (req) => {
            await relay.setProfiles(req.params.id, req.body?.profiles);
            return { ok: true };
          },
        );
        v1.delete<{ Params: { id: string } }>('/relay/devices/:id', async (req) => {
          await relay.revoke(req.params.id);
          return { ok: true };
        });
      }
      v1.get<{ Params: { id: string }; Querystring: { tail?: string } }>(
        '/profiles/:id/logs',
        async (req) => {
          const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 5000);
          return { lines: await service.logs(req.params.id, tail) };
        },
      );
    },
    { prefix: API_BASE_PATH },
  );

  if (mobileDir) {
    app.get('/*', async (req, reply) => {
      const wanted = decodeURIComponent((req.params as { '*': string })['*'] || 'index.html');
      const file = path.resolve(mobileDir, wanted);
      if (!file.startsWith(path.resolve(mobileDir) + path.sep)) return reply.code(404).send();
      try {
        const body = await readFile(file);
        return reply
          .type(CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream')
          .header('Cache-Control', 'no-cache')
          .send(body);
      } catch {
        return reply.code(404).send();
      }
    });
  }

  return app;
}

export async function listen(app: FastifyInstance, port: number): Promise<void> {
  // Hard rule 4: never 0.0.0.0.
  await app.listen({ host: LOOPBACK, port });
}

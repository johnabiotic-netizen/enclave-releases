// The local API (specs/agent-api.md). Binds 127.0.0.1 only and requires the bearer token.

import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  API_BASE_PATH,
  type CreateProfileRequest,
  type HealthResponse,
  type UpdateProfileRequest,
} from '@enclave/shared';
import { AgentError, InputError } from './errors.js';
import type { ProfileService } from './profiles.js';
import type { DockerRuntime } from './docker/runtime.js';

export const AGENT_VERSION = '0.1.0';
const LOOPBACK = '127.0.0.1';

export function buildServer(
  token: string,
  service: ProfileService,
  runtime: DockerRuntime,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const expected = Buffer.from(`Bearer ${token}`);

  app.addHook('onRequest', async (req, reply) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Missing or wrong agent token.' } });
    }
  });

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
      v1.post<{ Params: { id: string } }>('/profiles/:id/check-proxy', async (req) =>
        service.checkProfileProxy(req.params.id),
      );
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

  return app;
}

export async function listen(app: FastifyInstance, port: number): Promise<void> {
  // Hard rule 4: never 0.0.0.0.
  await app.listen({ host: LOOPBACK, port });
}

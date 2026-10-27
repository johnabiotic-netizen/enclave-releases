import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DockerRuntime } from './docker/runtime.js';
import type { ProfileService } from './profiles.js';
import { buildServer } from './server.js';

const TOKEN = 'test-token-that-is-long-enough-123';
const mobileDir = mkdtempSync(path.join(os.tmpdir(), 'enclave-mobile-'));
writeFileSync(path.join(mobileDir, 'index.html'), '<!doctype html><title>app</title>');

const service = { list: async () => [] } as unknown as ProfileService;
const runtime = { ping: async () => true } as unknown as DockerRuntime;
const app = buildServer(TOKEN, service, runtime, mobileDir);
afterAll(() => app.close());

describe('agent server', () => {
  it('requires the token for the API', async () => {
    expect((await app.inject({ url: '/v1/profiles' })).statusCode).toBe(401);
    const ok = await app.inject({
      url: '/v1/profiles',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('does not let an encoded or odd path reach the API without the token', async () => {
    for (const url of [
      '/%76%31/profiles',
      '/v1%2Fprofiles',
      '//v1/profiles',
      '/v1/../v1/profiles',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).not.toBe(200);
      expect(res.body, url).not.toContain('[]');
    }
  });

  it('serves the phone app without the token, and nothing outside its folder', async () => {
    const page = await app.inject({ url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect((await app.inject({ url: '/..%2f..%2fpackage.json' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/missing.js' })).statusCode).toBe(404);
  });
});

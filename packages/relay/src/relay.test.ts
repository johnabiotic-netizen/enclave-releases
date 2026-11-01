import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  exportPublicKey,
  generateTunnelKey,
  RELAY_CLOSE,
  TUNNEL_FRAME,
  type RelayToPc,
  type RelayToPhone,
} from '@enclave/shared';
import type { RelayConfig } from './config.js';
import { buildRelay, type Relay } from './server.js';

let relay: Relay;
let base: string;
let dir: string;

const config = (d: string): RelayConfig => ({
  host: '127.0.0.1',
  port: 0,
  dataDir: path.join(d, 'data'),
  staticDir: path.join(d, 'static'),
  signup: 'invite',
  inviteCode: 'test-invite-code-123',
  trustProxy: false,
  turn: {
    secret: 'x'.repeat(40),
    host: 'relay.example.com',
    ip: '203.0.113.7',
    port: 3478,
    tlsPort: 5349,
  },
});

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'enclave-relay-'));
  mkdirSync(path.join(dir, 'static'));
  writeFileSync(path.join(dir, 'static', 'index.html'), '<!doctype html><title>app</title>');
  relay = await buildRelay(config(dir));
  await relay.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = relay.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await relay.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown, auth?: string) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A WebSocket with a queue of the JSON messages it got. */
function socket(kind: 'pc' | 'phone', headers: Record<string, string> = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/r/v1/ws/${kind}`, { headers });
  const got: unknown[] = [];
  const binary: Buffer[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) binary.push(data as Buffer);
    else got.push(JSON.parse(String(data)));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  const next = async <T>(type: string): Promise<T> => {
    for (;;) {
      const i = got.findIndex((m) => (m as { type: string }).type === type);
      if (i >= 0) return got.splice(i, 1)[0] as T;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const nextBinary = async (): Promise<Buffer> => {
    for (;;) {
      if (binary.length) return binary.shift()!;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const open = new Promise<void>((r, j) => {
    ws.on('open', () => r());
    ws.on('error', j);
  });
  return { ws, next, nextBinary, closed, open, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('relay', () => {
  let pcAuth = '';
  let pcId = '';
  let pc: ReturnType<typeof socket>;
  let deviceId = '';
  let deviceKey = '';
  const phoneKey = generateTunnelKey(false).then((k) => exportPublicKey(k.publicKey));
  const pcKey = generateTunnelKey(true).then((k) => exportPublicKey(k.publicKey));

  it('serves the phone app and says how to sign up', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await call('GET', '/r/v1/info')).body).toMatchObject({ signup: 'invite' });
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
  });

  it('makes an account only with the invite code', async () => {
    const acc = { email: 'Owner@Example.com', password: 'a long password' };
    expect((await call('POST', '/r/v1/accounts', acc)).status).toBe(403);
    expect(
      (await call('POST', '/r/v1/accounts', { ...acc, inviteCode: 'test-invite-code-123' })).status,
    ).toBe(201);
    expect(
      (await call('POST', '/r/v1/accounts', { ...acc, inviteCode: 'test-invite-code-123' })).status,
    ).toBe(409);
  });

  it('registers a PC with the account password, and its socket with the PC secret', async () => {
    const wrong = await call('POST', '/r/v1/pcs', {
      email: 'owner@example.com',
      password: 'wrong password',
      name: 'Desk',
      publicKey: await pcKey,
    });
    expect(wrong.status).toBe(401);
    const ok = await call('POST', '/r/v1/pcs', {
      email: 'owner@example.com',
      password: 'a long password',
      name: 'Desk',
      publicKey: await pcKey,
    });
    expect(ok.status).toBe(201);
    pcId = ok.body.pcId as string;
    pcAuth = `${pcId}.${ok.body.pcSecret as string}`;

    const bad = socket('pc');
    await bad.open;
    bad.send({ type: 'REGISTER', pcId, pcSecret: 'nope', version: 't' });
    expect(await bad.closed).toBe(RELAY_CLOSE.UNAUTHORIZED);

    pc = socket('pc');
    await pc.open;
    pc.send({ type: 'REGISTER', pcId, pcSecret: ok.body.pcSecret, version: 't' });
    const reg = await pc.next<Extract<RelayToPc, { type: 'REGISTERED' }>>('REGISTERED');
    expect(reg.turn).toMatchObject({ ip: '203.0.113.7', port: 3478 });
    expect(reg.turn!.username).toMatch(new RegExp(`^\\d+:${pcId}$`));
  });

  it('pairs a phone only when the PC accepts its proof, and only once per code', async () => {
    const claim = async (code: string) =>
      call('POST', '/r/v1/pairings/claim', {
        code,
        deviceName: 'Phone',
        publicKey: await phoneKey,
        proof: 'p'.repeat(43),
      });

    // The PC says no: nothing is saved.
    let pairing = await call('POST', '/r/v1/pairings', undefined, pcAuth);
    expect(pairing.status).toBe(201);
    let claiming = claim(pairing.body.code as string);
    let req = await pc.next<Extract<RelayToPc, { type: 'PAIRING_REQUEST' }>>('PAIRING_REQUEST');
    expect(req.publicKey).toBe(await phoneKey);
    pc.send({ type: 'PAIRING_RESULT', pairingId: req.pairingId, ok: false });
    expect((await claiming).status).toBe(403);
    expect((await call('GET', '/r/v1/devices', undefined, pcAuth)).body).toEqual([]);

    // The PC says yes.
    pairing = await call('POST', '/r/v1/pairings', undefined, pcAuth);
    claiming = claim(pairing.body.code as string);
    req = await pc.next('PAIRING_REQUEST');
    pc.send({ type: 'PAIRING_RESULT', pairingId: req.pairingId, ok: true });
    const done = await claiming;
    expect(done.status).toBe(200);
    expect(done.body.pc).toEqual({ id: pcId, name: 'Desk', publicKey: await pcKey });
    deviceId = done.body.deviceId as string;
    deviceKey = done.body.deviceKey as string;

    // The same code again: gone.
    expect((await claim(pairing.body.code as string)).status).toBe(410);
  });

  it('refuses a phone socket from another site', async () => {
    const other = socket('phone', { Origin: 'https://evil.example.com' });
    await expect(other.open).rejects.toThrow(/403/);
  });

  it('passes tunnel frames between the two sides of a session, and nobody else', async () => {
    const phone = socket('phone');
    await phone.open;
    phone.send({ type: 'HELLO', deviceId, deviceKey, version: 't' });
    const welcome = await phone.next<Extract<RelayToPhone, { type: 'WELCOME' }>>('WELCOME');
    expect(welcome.pc).toEqual({ id: pcId, name: 'Desk', online: true });

    phone.send({ type: 'OPEN_SESSION' });
    const granted =
      await phone.next<Extract<RelayToPhone, { type: 'SESSION_GRANTED' }>>('SESSION_GRANTED');
    expect(granted.iceServers[1]!.urls).toContain('turns:relay.example.com:5349?transport=tcp');
    const request =
      await pc.next<Extract<RelayToPc, { type: 'SESSION_REQUEST' }>>('SESSION_REQUEST');
    expect(request).toMatchObject({ sessionId: granted.sessionId, deviceId });

    const frame = (payload: string) =>
      Buffer.concat([
        Buffer.from([TUNNEL_FRAME]),
        Buffer.from(granted.sessionId, 'hex'),
        Buffer.from(payload),
      ]);
    phone.ws.send(frame('to pc'));
    expect(String((await pc.nextBinary()).subarray(17))).toBe('to pc');
    pc.ws.send(frame('to phone'));
    expect(String((await phone.nextBinary()).subarray(17))).toBe('to phone');

    // Revoking cuts the phone off at once, session included.
    expect((await call('DELETE', `/r/v1/devices/${deviceId}`, undefined, pcAuth)).status).toBe(200);
    await phone.next('REVOKED');
    expect(await phone.closed).toBe(RELAY_CLOSE.REVOKED);
    await pc.next('SESSION_CLOSED');

    // And it can't come back.
    const again = socket('phone');
    await again.open;
    again.send({ type: 'HELLO', deviceId, deviceKey, version: 't' });
    expect(await again.closed).toBe(RELAY_CLOSE.REVOKED);
  });

  it('keeps nothing but accounts, PCs and phones on disk', async () => {
    const { readFileSync } = await import('node:fs');
    const saved = JSON.parse(readFileSync(path.join(dir, 'data', 'relay.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(saved).sort()).toEqual(['accounts', 'devices', 'pcs', 'version']);
    expect(JSON.stringify(saved)).not.toContain('a long password');
    expect(JSON.stringify(saved)).not.toContain(pcAuth.split('.')[1]);
  });
});

describe('single-use invites', () => {
  it('make one account each, and only from the relay itself', async () => {
    const made = await call('POST', '/r/v1/admin/invites', { note: 'tester one' });
    expect(made.status).toBe(201);
    const code = made.body.code as string;
    const first = { email: 'tester1@example.com', password: 'a long password', inviteCode: code };
    expect((await call('POST', '/r/v1/accounts', first)).status).toBe(201);
    const second = { email: 'tester2@example.com', password: 'a long password', inviteCode: code };
    const again = await call('POST', '/r/v1/accounts', second);
    expect(again.status).toBe(403);
    expect(again.body).toMatchObject({ error: { code: 'INVITE_REQUIRED' } });
    const list = (await call('GET', '/r/v1/admin/invites')).body as unknown as Record<
      string,
      unknown
    >[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note: 'tester one', usedBy: 'tester1@example.com' });
    expect(JSON.stringify(list)).not.toContain(code);
  });
});

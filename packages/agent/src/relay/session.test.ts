import { describe, expect, it } from 'vitest';
import {
  CHANNEL,
  generateTunnelKey,
  packChannel,
  textOf,
  Tunnel,
  unpackChannel,
  unpackResponse,
  type PhoneProfiles,
} from '@enclave/shared';
import { TunnelSession, type TunnelBackend } from './session.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** A phone tunnel talking to a PC session whose agent is a fake that records its calls. */
async function setup(scope: { value: PhoneProfiles }) {
  const phoneKey = await generateTunnelKey(false);
  const pcKey = await generateTunnelKey(true);
  const calls: string[] = [];
  const backend: TunnelBackend = {
    inject: async (req) => {
      calls.push(`${req.method} ${req.url}`);
      const body =
        req.url === '/v1/profiles'
          ? JSON.stringify([
              { id: A, name: 'Shared' },
              { id: B, name: 'Private' },
            ])
          : '{"ok":true}';
      return { status: 200, contentType: 'application/json', body: Buffer.from(body) };
    },
    streamPort: async (id) => {
      calls.push(`stream ${id}`);
      throw new Error('not running');
    },
  };
  const phone: Tunnel = new Tunnel('phone', phoneKey, pcKey.publicKey, (b) =>
    queueMicrotask(() => pc.receive(b)),
  );
  const pc: Tunnel = new Tunnel('pc', pcKey, phoneKey.publicKey, (b) =>
    queueMicrotask(() => phone.receive(b)),
  );
  const session = new TunnelSession(
    pc,
    backend,
    () => {},
    () => scope.value,
  );
  const inbox: { kind: number; channel: number; data: Uint8Array }[] = [];
  const waiters: (() => void)[] = [];
  phone.onMessage = (b) => {
    inbox.push(unpackChannel(b));
    waiters.splice(0).forEach((w) => w());
  };
  await phone.open();
  let next = 1;
  const reply = async (channel: number, kind: number) => {
    for (;;) {
      const i = inbox.findIndex((m) => m.channel === channel && m.kind === kind);
      if (i >= 0) return inbox.splice(i, 1)[0]!.data;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  const request = async (method: string, path: string) => {
    const ch = next++;
    await phone.post(packChannel(CHANNEL.REQUEST, ch, JSON.stringify({ method, path })));
    await phone.post(packChannel(CHANNEL.END, ch));
    const { head, body } = unpackResponse(await reply(ch, CHANNEL.RESPONSE));
    return { status: head.status, body: JSON.parse(textOf(body)) as unknown };
  };
  const socket = async (path: string) => {
    const ch = next++;
    await phone.post(packChannel(CHANNEL.WS_OPEN, ch, JSON.stringify({ path })));
    return JSON.parse(textOf(await reply(ch, CHANNEL.WS_CLOSE))) as { code: number };
  };
  return { request, socket, calls, session };
}

describe('a phone limited to some profiles', () => {
  it('sees only those in the list and is refused the others everywhere', async () => {
    const scope: { value: PhoneProfiles } = { value: [A] };
    const { request, socket, calls } = await setup(scope);

    const list = await request('GET', '/v1/profiles');
    expect(list.body).toEqual([{ id: A, name: 'Shared' }]);

    for (const [method, path] of [
      ['POST', `/v1/profiles/${B}/start`],
      ['POST', `/v1/profiles/${B}/stop`],
      ['GET', `/v1/profiles/${B}/stream`],
      ['GET', `/v1/profiles/${B}/media`],
      ['POST', `/v1/profiles/${B}/files?name=x.jpg`],
    ] as const) {
      const res = await request(method, path);
      expect(res.status, path).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'PROFILE_NOT_FOUND' } });
    }
    expect((await request('POST', `/neko/${B}/api/login`)).status).toBe(401);
    expect((await socket(`/neko/${B}/api/ws?token=x`)).code).toBe(4403);

    // The PC's own API was never asked about the other profile.
    expect(calls.filter((c) => c.includes(B))).toEqual([]);
    // The shared one goes through.
    expect((await request('POST', `/v1/profiles/${A}/start`)).status).toBe(200);
    expect(calls).toContain(`POST /v1/profiles/${A}/start`);
  });

  it('follows a change at once', async () => {
    const scope: { value: PhoneProfiles } = { value: [A] };
    const { request } = await setup(scope);
    scope.value = 'all';
    expect((await request('GET', '/v1/profiles')).body).toHaveLength(2);
    scope.value = [B];
    expect((await request('GET', '/v1/profiles')).body).toEqual([{ id: B, name: 'Private' }]);
    expect((await request('POST', `/v1/profiles/${A}/start`)).status).toBe(404);
  });

  it('still reaches nothing outside the phone app calls', async () => {
    const { request, calls } = await setup({ value: 'all' });
    for (const path of ['/v1/system', `/v1/profiles/${A}`, `/v1/profiles/${A}/logs`]) {
      expect((await request('GET', path)).status, path).toBe(404);
    }
    expect((await request('DELETE', `/v1/profiles/${A}`)).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe('a large download through the tunnel', () => {
  it('arrives whole, in pieces, with only a few in flight', async () => {
    const big = Buffer.alloc(1_300_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
    const phoneKey = await generateTunnelKey(false);
    const pcKey = await generateTunnelKey(true);
    const backend: TunnelBackend = {
      inject: async () => ({ status: 200, contentType: 'application/octet-stream', body: big }),
      streamPort: async () => 1,
    };
    let inFlightMax = 0;
    let inFlight = 0;
    const phone: Tunnel = new Tunnel('phone', phoneKey, pcKey.publicKey, (b) =>
      queueMicrotask(() => pc.receive(b)),
    );
    const pc: Tunnel = new Tunnel('pc', pcKey, phoneKey.publicKey, (b) =>
      queueMicrotask(() => phone.receive(b)),
    );
    new TunnelSession(
      pc,
      backend,
      () => {},
      () => 'all',
    );
    const parts: Uint8Array[] = [];
    let head: { status: number; length: number } | null = null;
    const done = new Promise<void>((resolve) => {
      phone.onMessage = (b) => {
        const m = unpackChannel(b);
        if (m.kind === CHANNEL.RESPONSE_START) head = JSON.parse(textOf(m.data));
        if (m.kind === CHANNEL.RESPONSE_DATA) {
          parts.push(m.data.slice());
          inFlightMax = Math.max(inFlightMax, ++inFlight);
          // The phone takes each piece a little later, as a slow network would.
          setTimeout(() => {
            inFlight--;
            void phone.post(packChannel(CHANNEL.RESPONSE_ACK, 1));
          }, 5);
        }
        if (m.kind === CHANNEL.RESPONSE_END) resolve();
      };
    });
    await phone.open();
    const id = '11111111-1111-4111-8111-111111111111';
    await phone.post(
      packChannel(
        CHANNEL.REQUEST,
        1,
        JSON.stringify({ method: 'GET', path: `/v1/profiles/${id}/downloads/a.zip` }),
      ),
    );
    await phone.post(packChannel(CHANNEL.END, 1));
    await done;
    expect(head).toMatchObject({ status: 200, length: big.length });
    expect(Buffer.concat(parts).equals(big)).toBe(true);
    expect(parts.length).toBe(Math.ceil(big.length / (256 * 1024)));
    expect(inFlightMax).toBeLessThanOrEqual(8);
  });
});

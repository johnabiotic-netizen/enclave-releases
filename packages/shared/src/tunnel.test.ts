import { describe, expect, it } from 'vitest';
import {
  checkPairingProof,
  exportPrivateKey,
  exportPublicKey,
  formatPairingLink,
  generateTunnelKey,
  importKeyPair,
  pairingProof,
  parsePairingFragment,
  pcKeyHash,
  randomBytes,
  toBase64Url,
  Tunnel,
  TunnelError,
} from './tunnel.js';

const text = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

/** A phone and a PC tunnel joined by a "relay" that can watch or change what passes. */
async function pair(
  opts: { tamper?: (b: Uint8Array) => Uint8Array; pcThinksPhone?: CryptoKey } = {},
) {
  const phoneKey = await generateTunnelKey(false);
  const pcKey = await generateTunnelKey(true);
  const seen: Uint8Array[] = [];
  const pass = (to: () => Tunnel) => (b: Uint8Array) => {
    seen.push(b);
    const out = opts.tamper ? opts.tamper(b) : b;
    queueMicrotask(() => to().receive(out));
  };
  const phone: Tunnel = new Tunnel(
    'phone',
    phoneKey,
    pcKey.publicKey,
    pass(() => pc),
  );
  const pc: Tunnel = new Tunnel(
    'pc',
    pcKey,
    opts.pcThinksPhone ?? phoneKey.publicKey,
    pass(() => phone),
  );
  const atPhone: string[] = [];
  const atPc: string[] = [];
  phone.onMessage = (b) => atPhone.push(str(b));
  pc.onMessage = (b) => atPc.push(str(b));
  await phone.open();
  return { phone, pc, atPhone, atPc, seen };
}

describe('tunnel', () => {
  it('carries messages both ways, in order, and the relay sees no plaintext', async () => {
    const { phone, pc, atPhone, atPc, seen } = await pair();
    await Promise.all([1, 2, 3, 4, 5].map((n) => phone.post(text(`secret profile ${n}`))));
    await pc.ready;
    await pc.post(text('secret answer'));
    await phone.ready;
    expect(atPc).toEqual([1, 2, 3, 4, 5].map((n) => `secret profile ${n}`));
    expect(atPhone).toEqual(['secret answer']);
    const wire = seen.map((b) => Buffer.from(b).toString('latin1')).join('');
    expect(wire).not.toContain('secret');
  });

  it('refuses a PC that holds another phone key (a relay in the middle)', async () => {
    const other = await generateTunnelKey(false);
    const { phone, pc, atPc } = await pair({ pcThinksPhone: other.publicKey });
    const failed = new Promise<Error>((r) => (pc.onError = r));
    await phone.post(text('hello'));
    expect(await failed).toBeInstanceOf(TunnelError);
    expect(atPc).toEqual([]);
  });

  it('notices a changed message', async () => {
    let n = 0;
    const { phone, pc } = await pair({
      tamper: (b) => {
        if (b[0] === 1 && n++ === 1) {
          const c = b.slice();
          c[c.length - 1]! ^= 1;
          return c;
        }
        return b;
      },
    });
    const failed = new Promise<Error>((r) => (pc.onError = r));
    await phone.post(text('one'));
    await phone.post(text('two'));
    expect((await failed).message).toMatch(/failed its check/);
  });

  it('notices a replayed message', async () => {
    let first: Uint8Array | null = null;
    const { phone, pc } = await pair({
      tamper: (b) => {
        if (b[0] !== 1) return b;
        if (!first) first = b;
        return first; // the second message is the first one again
      },
    });
    const failed = new Promise<Error>((r) => (pc.onError = r));
    await phone.post(text('one'));
    await phone.post(text('two'));
    expect(await failed).toBeInstanceOf(TunnelError);
  });

  it('keeps the PC key across a save (JWK)', async () => {
    const pcKey = await generateTunnelKey(true);
    const again = await importKeyPair(await exportPrivateKey(pcKey.privateKey));
    expect(await exportPublicKey(again.publicKey)).toBe(await exportPublicKey(pcKey.publicKey));
  });
});

describe('pairing', () => {
  it('a proof made with the QR secret checks; any other does not', async () => {
    const secret = toBase64Url(randomBytes(16));
    const phone = await exportPublicKey((await generateTunnelKey(false)).publicKey);
    const pc = await exportPublicKey((await generateTunnelKey(true)).publicKey);
    const other = await exportPublicKey((await generateTunnelKey(false)).publicKey);
    const proof = await pairingProof(secret, phone, pc);
    expect(await checkPairingProof(secret, phone, pc, proof)).toBe(true);
    expect(await checkPairingProof(secret, other, pc, proof)).toBe(false);
    expect(await checkPairingProof(toBase64Url(randomBytes(16)), phone, pc, proof)).toBe(false);
    expect(await checkPairingProof(secret, phone, pc, 'not base64!')).toBe(false);
  });

  it('the link round-trips', async () => {
    const pc = await exportPublicKey((await generateTunnelKey(true)).publicKey);
    const link = {
      code: 'abcDEF123',
      secret: toBase64Url(randomBytes(16)),
      pcKeyHash: await pcKeyHash(pc),
    };
    const url = formatPairingLink('https://relay.example.com/', link);
    expect(url.startsWith('https://relay.example.com/#pair=')).toBe(true);
    expect(parsePairingFragment(new URL(url).hash)).toEqual(link);
    expect(parsePairingFragment('#pair=a.b')).toBeNull();
  });
});

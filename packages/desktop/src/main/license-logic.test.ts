import { describe, expect, it } from 'vitest';
import type { VerifyResult } from '@enclave/agent';
import { CHECK_EVERY_MS, GRACE_MS, decide, needsCheck } from './license-logic.js';

const good: VerifyResult = {
  ok: true,
  payload: {
    v: 1,
    id: 'k1k1k1k1k1',
    name: 'Tester',
    issued: '2026-11-18',
    expires: '2026-12-31',
    pcs: 1,
  },
};
const now = new Date('2026-12-01T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('license decisions', () => {
  it('a bad key is never licensed, whatever the relay says', () => {
    const r = decide({
      local: { ok: false, problem: 'bad-signature' },
      online: 'ok',
      lastGood: null,
      now,
    });
    expect(r.status).toEqual({ licensed: false, problem: 'bad-signature' });
  });

  it('a good relay answer licenses and records the check time', () => {
    const r = decide({ local: good, online: 'ok', lastGood: null, now });
    expect(r.status).toMatchObject({
      licensed: true,
      name: 'Tester',
      lastCheck: now.toISOString(),
    });
    expect(r.lastGood).toBe(now.toISOString());
  });

  it('revoked, expired and other-pc lock the app and clear the last good check', () => {
    for (const [online, problem] of [
      ['revoked', 'revoked'],
      ['expired', 'expired'],
      ['other-pc', 'other-pc'],
      ['invalid', 'bad-signature'],
    ] as const) {
      const r = decide({ local: good, online, lastGood: ago(1000), now });
      expect(r.status).toMatchObject({ licensed: false, problem });
      expect(r.lastGood).toBeNull();
    }
  });

  it('keeps working offline for 14 days, then asks for a connection', () => {
    const inside = decide({
      local: good,
      online: 'unreachable',
      lastGood: ago(GRACE_MS - 60_000),
      now,
    });
    expect(inside.status.licensed).toBe(true);
    const outside = decide({
      local: good,
      online: 'unreachable',
      lastGood: ago(GRACE_MS + 60_000),
      now,
    });
    expect(outside.status).toMatchObject({ licensed: false, problem: 'unreachable' });
  });

  it('never checked online means not licensed while offline', () => {
    const r = decide({ local: good, online: 'unreachable', lastGood: null, now });
    expect(r.status).toMatchObject({ licensed: false, problem: 'unreachable' });
  });

  it('a check is due once a day', () => {
    expect(needsCheck(null, now)).toBe(true);
    expect(needsCheck(ago(CHECK_EVERY_MS - 60_000), now)).toBe(false);
    expect(needsCheck(ago(CHECK_EVERY_MS + 60_000), now)).toBe(true);
  });
});

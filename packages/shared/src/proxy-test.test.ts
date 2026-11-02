import { describe, expect, it } from 'vitest';
import { expandProxyLines, rateProxy } from './proxy-test.js';

describe('expandProxyLines', () => {
  it('expands a port range in both forms and keeps plain lines', () => {
    const { proxies, error } = expandProxyLines(
      [
        'socks5://u:p@h.example:10001-10003',
        '# a comment',
        '',
        'h.example:20-21:user:pass',
        'http://u:p@other:8080',
      ].join('\n'),
    );
    expect(error).toBeUndefined();
    expect(proxies).toEqual([
      'socks5://u:p@h.example:10001',
      'socks5://u:p@h.example:10002',
      'socks5://u:p@h.example:10003',
      'h.example:20:user:pass',
      'h.example:21:user:pass',
      'http://u:p@other:8080',
    ]);
  });

  it('leaves a password that looks like a range alone', () => {
    expect(expandProxyLines('host:8080:user:12-34').proxies).toEqual(['host:8080:user:12-34']);
  });

  it('names the line that is not a proxy', () => {
    expect(expandProxyLines(['h:1:u:p', 'not a proxy'].join('\n')).error).toMatch(
      /^Line 2: Use socks5/,
    );
  });

  it('refuses a reversed range and too many proxies', () => {
    expect(expandProxyLines('h:30-20:u:p').error).toMatch(/not a range/);
    expect(expandProxyLines('h:1-1001:u:p').error).toMatch(/At most 1000/);
  });
});

describe('rateProxy', () => {
  it('rates a failed check as not usable', () => {
    expect(rateProxy({ ok: false, problem: 'Proxy unreachable.' })).toEqual({
      level: 'bad',
      notes: ['Proxy unreachable.'],
    });
  });

  it('warns about database listings, slow answers and a changing IP', () => {
    const r = rateProxy({
      ok: true,
      hosting: true,
      proxyFlag: false,
      latencyMs: 2400,
      sticky: false,
    });
    expect(r.level).toBe('warning');
    expect(r.notes).toHaveLength(3);
  });

  it('rates a clean residential proxy as good', () => {
    const r = rateProxy({ ok: true, hosting: false, proxyFlag: false, latencyMs: 300 });
    expect(r).toEqual({
      level: 'good',
      notes: ['IP databases list it as a home or business address.'],
    });
  });
});

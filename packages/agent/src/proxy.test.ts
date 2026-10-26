import { describe, expect, it } from 'vitest';
import { InputError } from './errors.js';
import { describeProxy, judgeProxyCheck, parseProxy } from './proxy.js';

describe('parseProxy', () => {
  it('reads the three documented formats', () => {
    expect(parseProxy('socks5://user:pass@1.2.3.4:1080')).toEqual({
      type: 'socks5',
      host: '1.2.3.4',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
    expect(parseProxy('http://u:p@proxy.example.com:8080')).toMatchObject({
      type: 'http',
      host: 'proxy.example.com',
    });
    expect(parseProxy('proxy.example.com:3128:u:p')).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 3128,
      username: 'u',
      password: 'p',
    });
  });

  it('decodes URL-encoded credentials and accepts https and socks5h', () => {
    expect(parseProxy('https://us%40er:p%3Ass@h.example:443')).toMatchObject({
      type: 'https',
      username: 'us@er',
      password: 'p:ss',
    });
    expect(parseProxy('socks5h://h:1')).toMatchObject({ type: 'socks5' });
  });

  it('accepts host:port without credentials and structured input', () => {
    expect(parseProxy('10.0.0.1:8080')).toEqual({ type: 'http', host: '10.0.0.1', port: 8080 });
    expect(parseProxy({ type: 'socks5', host: 'h', port: 9 })).toEqual({
      type: 'socks5',
      host: 'h',
      port: 9,
    });
  });

  it('rejects bad input with a readable message', () => {
    for (const bad of ['', 'ftp://h:1', 'h:99999', 'just-a-host', 'a:b:c', 'socks5://h']) {
      expect(() => parseProxy(bad), bad).toThrow(InputError);
    }
  });
});

describe('describeProxy', () => {
  it('never includes the password', () => {
    const text = describeProxy(parseProxy('socks5://user:secret@h:1'));
    expect(text).toBe('socks5://user@h:1');
    expect(text).not.toContain('secret');
  });
});

describe('judgeProxyCheck', () => {
  const good = {
    tcpOk: true,
    exitIps: ['5.6.7.8', '5.6.7.8'],
    exitIp: '5.6.7.8',
    realIp: '1.2.3.4',
    country: 'US',
    timezone: 'America/New_York',
  };

  it('passes a working proxy', () => {
    expect(judgeProxyCheck(good)).toEqual({ ok: true });
  });

  it('fails when the proxy is down or the echo services disagree', () => {
    expect(judgeProxyCheck({ tcpOk: false, error: 'refused' })).toMatchObject({
      ok: false,
      code: 'PROXY_UNREACHABLE',
    });
    expect(judgeProxyCheck({ ...good, exitIps: ['5.6.7.8', '9.9.9.9'] })).toMatchObject({
      ok: false,
      code: 'PROXY_UNREACHABLE',
    });
  });

  it('flags a proxy that exits through the real IP, unless it is the test proxy', () => {
    const leaky = { ...good, realIp: '5.6.7.8' };
    expect(judgeProxyCheck(leaky)).toMatchObject({ ok: false, code: 'REAL_IP_LEAK_SUSPECTED' });
    expect(judgeProxyCheck(leaky, true)).toMatchObject({ ok: true });
    expect(judgeProxyCheck({ ...good, realIp: undefined })).toMatchObject({
      ok: false,
      code: 'REAL_IP_LEAK_SUSPECTED',
    });
  });
});

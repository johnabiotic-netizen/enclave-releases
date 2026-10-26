// Proxy strings (docs/06-proxies.md) and the safety check's verdict.

import { PROXY_TYPES, type ProxyInput, type ProxySpec, type ProxyType } from '@enclave/shared';
import { InputError } from './errors.js';

const SCHEME_TYPES: Record<string, ProxyType> = {
  socks5: 'socks5',
  socks5h: 'socks5',
  http: 'http',
  https: 'https',
};

/**
 * Accepts `socks5://user:pass@host:port`, `http://user:pass@host:port` (also https://),
 * `host:port:user:pass` (assumed http, the common provider format) and `host:port`, or a
 * structured object.
 */
export function parseProxy(spec: ProxySpec): ProxyInput {
  if (typeof spec !== 'string') return validate({ ...spec });
  const text = spec.trim();
  if (!text) throw new InputError('The proxy is empty.');

  const scheme = /^([a-z0-9]+):\/\//i.exec(text);
  if (scheme) {
    const type = SCHEME_TYPES[scheme[1]!.toLowerCase()];
    if (!type)
      throw new InputError(
        `Proxy type "${scheme[1]}" is not supported. Use socks5, http or https.`,
      );
    let url: URL;
    try {
      url = new URL(`http://${text.slice(scheme[0].length)}`);
    } catch {
      throw new InputError('The proxy address is not valid.');
    }
    return validate({
      type,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    });
  }

  const parts = text.split(':');
  if (parts.length !== 2 && parts.length !== 4) {
    throw new InputError(
      'Use socks5://user:pass@host:port, http://user:pass@host:port or host:port:user:pass.',
    );
  }
  const [host, port, username, password] = parts;
  return validate({
    type: 'http',
    host: host!,
    port: Number(port),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  });
}

function validate(p: ProxyInput): ProxyInput {
  if (!(PROXY_TYPES as readonly string[]).includes(p.type)) {
    throw new InputError(`Proxy type "${p.type}" is not supported. Use socks5, http or https.`);
  }
  if (!p.host || /[\s/@]/.test(p.host))
    throw new InputError('The proxy host is missing or not valid.');
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
    throw new InputError('The proxy port must be a number from 1 to 65535.');
  }
  return p;
}

/** For logs and messages: never includes the password. */
export function describeProxy(p: Pick<ProxyInput, 'type' | 'host' | 'port' | 'username'>): string {
  return `${p.type}://${p.username ? `${p.username}@` : ''}${p.host}:${p.port}`;
}

/** What check_proxy.py prints (images/browser/check_proxy.py). */
export interface RawProxyCheck {
  tcpOk?: boolean;
  latencyMs?: number;
  exitIps?: string[];
  exitIp?: string;
  realIp?: string;
  realIpError?: string;
  country?: string;
  timezone?: string;
  locale?: string;
  lat?: number;
  lon?: number;
  error?: string;
  geoError?: string;
}

export type ProxyVerdict =
  | { ok: true; warning?: string }
  | { ok: false; code: 'PROXY_UNREACHABLE' | 'REAL_IP_LEAK_SUSPECTED'; message: string };

/**
 * Steps 1, 2 and 5 of the safety check. `allowRealIp` is for the built-in test proxy only,
 * whose exit IP is the PC's own by design.
 */
export function judgeProxyCheck(raw: RawProxyCheck, allowRealIp = false): ProxyVerdict {
  if (raw.error || !raw.tcpOk) {
    return {
      ok: false,
      code: 'PROXY_UNREACHABLE',
      message: `Proxy unreachable. Check the proxy details or try again. (${raw.error ?? 'no answer'})`,
    };
  }
  const ips = raw.exitIps ?? [];
  if (ips.length < 2 || ips.some((ip) => ip !== ips[0])) {
    return {
      ok: false,
      code: 'PROXY_UNREACHABLE',
      message: `The proxy gave different exit IPs (${ips.join(', ')}). Rotating proxies are not supported.`,
    };
  }
  if (!raw.country || !raw.timezone) {
    return {
      ok: false,
      code: 'PROXY_UNREACHABLE',
      message: raw.geoError ?? `No location found for the proxy's IP ${raw.exitIp}.`,
    };
  }
  if (!raw.realIp) {
    return {
      ok: false,
      code: 'REAL_IP_LEAK_SUSPECTED',
      message:
        "Couldn't check this PC's real IP, so the proxy can't be confirmed safe. Check the internet connection.",
    };
  }
  if (raw.realIp === raw.exitIp) {
    if (allowRealIp) {
      return {
        ok: true,
        warning: "Test proxy: traffic leaves through this PC's own IP. Not for real accounts.",
      };
    }
    return {
      ok: false,
      code: 'REAL_IP_LEAK_SUSPECTED',
      message: `The proxy's exit IP ${raw.exitIp} is this PC's own IP. It is not hiding anything.`,
    };
  }
  return { ok: true };
}

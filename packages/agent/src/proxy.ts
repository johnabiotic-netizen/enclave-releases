// Proxy strings (docs/06-proxies.md) and the safety check's verdict.

import { parseProxySpec, ProxyFormatError, type ProxyInput, type ProxySpec } from '@enclave/shared';
import { InputError } from './errors.js';

/** parseProxySpec (shared), with the agent's input error. */
export function parseProxy(spec: ProxySpec): ProxyInput {
  try {
    return parseProxySpec(spec);
  } catch (e) {
    if (e instanceof ProxyFormatError) throw new InputError(e.message);
    throw e;
  }
}

/** For logs and messages: never includes the password. */
export function describeProxy(p: Pick<ProxyInput, 'type' | 'host' | 'port' | 'username'>): string {
  return `${p.type}://${p.username ? `${p.username}@` : ''}${p.host}:${p.port}`;
}

/** What net_check.py prints (images/browser/net_check.py). */
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

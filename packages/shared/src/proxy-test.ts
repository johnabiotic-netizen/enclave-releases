// The proxy report (testing/test-suite.md, Proxy tester): what the create wizard's Check proxy
// and the Windows app's proxy tester show. Both rate a proxy with the same rules.

import type { ProxyCheckResult } from './proxy.js';
import { parseProxySpec } from './proxy-parse.js';

/** What IP databases (ip-api.com) say about an exit IP. Only the IP address is sent. */
export interface ProxyReputation {
  city?: string;
  isp?: string;
  /** Autonomous system, e.g. "AS7018". */
  asn?: string;
  /** Listed as a data centre or hosting address. */
  hosting?: boolean;
  /** Listed as a proxy, VPN or Tor exit. */
  proxy?: boolean;
  /** A mobile network address. */
  mobile?: boolean;
}

// POST /proxy-check: the safety check, plus the exit IP's reputation when the lookup answered.
export interface ProxyReport extends ProxyCheckResult {
  reputation?: ProxyReputation;
}

/** One proxy in a proxy test. */
export interface ProxyTestResult {
  /** Its position in the request's list, so a client can find the proxy it sent. */
  index: number;
  /** The proxy without its password. */
  proxy: string;
  /** Not checked yet. */
  pending?: boolean;
  ok: boolean;
  /** Why it failed the safety check, if it did. */
  problem?: string;
  exitIp?: string;
  country?: string;
  timezone?: string;
  latencyMs?: number;
  /** Exit IP at the second check, when a sticky check ran. */
  exitIpLater?: string;
  sticky?: boolean;
  city?: string;
  isp?: string;
  asn?: string;
  hosting?: boolean;
  proxyFlag?: boolean;
  mobile?: boolean;
  /** Enclave Scan in a temporary profile on this proxy: its verdict and proxy card. */
  scan?: string;
  scanProxy?: string;
  /** Lower is better: failing, flagged or unsticky proxies sort last. */
  score: number;
}

// POST /proxy-tests (202, then poll GET /proxy-tests/:jobId)
export interface ProxyTestRequest {
  /** Proxies in any accepted form, one each (ranges expanded by the client). */
  proxies?: string[];
  /** Ports on an existing profile's proxy host and login, so its password isn't typed again. */
  like?: { profileId: string; ports: [number, number] };
  /** Minutes before the sticky re-check (default 5, 0 skips it). */
  stickyMinutes?: number;
  /** Also run Enclave Scan per working proxy (about 1.5 minutes each). */
  scan?: boolean;
}

export interface ProxyTestJob {
  id: string;
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  total: number;
  checked: number;
  phase: 'first check' | 'waiting for the sticky check' | 'sticky check' | 'reputation' | 'scan';
  /** While the sticky check waits: when it starts. */
  stickyAt?: string;
  /** Every proxy, in request order while running; best first once done. */
  results?: ProxyTestResult[];
  reportDir?: string;
  /** The summary table, best first (also in the report folder). */
  table?: string;
  error?: string;
}

/** The most proxies one test takes. */
export const MAX_PROXY_TEST = 1000;
/** A proxy slower than this to answer gets a note. */
export const SLOW_PROXY_MS = 1500;

export type ProxyLevel = 'good' | 'warning' | 'bad';

export interface ProxyRating {
  level: ProxyLevel;
  /** Why, in the app's words: problems first, then plain facts. */
  notes: string[];
}

/** What the rating looks at: a test row, or the wizard's report flattened. */
export type RatedProxy = Pick<
  ProxyTestResult,
  | 'ok'
  | 'problem'
  | 'latencyMs'
  | 'hosting'
  | 'proxyFlag'
  | 'mobile'
  | 'sticky'
  | 'exitIpLater'
  | 'scan'
  | 'scanProxy'
>;

export function reportToRated(r: ProxyReport): RatedProxy {
  return {
    ok: r.ok,
    ...(r.latencyMs !== undefined ? { latencyMs: r.latencyMs } : {}),
    ...(r.reputation?.hosting !== undefined ? { hosting: r.reputation.hosting } : {}),
    ...(r.reputation?.proxy !== undefined ? { proxyFlag: r.reputation.proxy } : {}),
    ...(r.reputation?.mobile !== undefined ? { mobile: r.reputation.mobile } : {}),
  };
}

/**
 * Good, a warning, or not usable. IP databases don't predict detection sites well (a listed
 * IP can pass Enclave Scan, a clean one can fail it), so a database listing is a warning, and
 * only a failed safety check makes a proxy unusable.
 */
export function rateProxy(r: RatedProxy): ProxyRating {
  if (!r.ok) {
    return { level: 'bad', notes: [r.problem ?? 'The proxy failed the safety check.'] };
  }
  const warnings: string[] = [];
  const facts: string[] = [];
  if (r.scan !== undefined && r.scan !== 'consistent') {
    warnings.push(
      r.scan.startsWith('error')
        ? "Enclave Scan couldn't finish its check."
        : `Enclave Scan says ${r.scan}${r.scanProxy ? ` (${r.scanProxy})` : ''}.`,
    );
  }
  if (r.sticky === false) {
    warnings.push(
      `The IP changed between checks${r.exitIpLater ? `, to ${r.exitIpLater}` : ''}. Sites see a new address and may sign the profile out.`,
    );
  }
  if (r.proxyFlag) warnings.push('IP databases list this address as a proxy or VPN.');
  if (r.hosting) {
    warnings.push(
      'IP databases list this address as a data centre. Some sites treat that as a proxy.',
    );
  }
  if (r.latencyMs !== undefined && r.latencyMs > SLOW_PROXY_MS) {
    warnings.push(`Slow to answer (${r.latencyMs} ms). Pages will load slowly.`);
  }
  if (r.scan === 'consistent') facts.push('Enclave Scan says consistent.');
  if (r.sticky === true) facts.push('The IP stayed the same between checks.');
  if (r.mobile) facts.push('A mobile network address.');
  else if (r.hosting === false && r.proxyFlag === false) {
    facts.push('IP databases list it as a home or business address.');
  }
  return { level: warnings.length ? 'warning' : 'good', notes: [...warnings, ...facts] };
}

/** The kind of address, for a table column. */
export function addressKind(r: Pick<ProxyTestResult, 'hosting' | 'mobile'>): string | null {
  if (r.mobile) return 'Mobile';
  if (r.hosting === true) return 'Data centre';
  if (r.hosting === false) return 'Residential';
  return null;
}

/**
 * The proxy tester's input: one proxy per line, any accepted form, where the port may be a
 * range ("host:10001-10100:user:pass", "socks5://user:pass@host:10001-10100"). Blank lines
 * and lines starting with # are skipped. A line that isn't a proxy is an error naming it.
 */
export function expandProxyLines(text: string): { proxies: string[]; error?: string } {
  const proxies: string[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  const tooMany = { proxies: [], error: `At most ${MAX_PROXY_TEST} proxies in one test.` };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim();
    if (!line || line.startsWith('#')) continue;
    // The range is the port: in a URL, at the end; in host:port:user:pass, the second field.
    const m =
      /^([a-z0-9]+:\/\/(?:[^@]*@)?[^:@/]+:)(\d{1,5})-(\d{1,5})()$/i.exec(line) ??
      /^([^:/@]+:)(\d{1,5})-(\d{1,5})((?::[^:]*:.*)?)$/.exec(line);
    if (!m) {
      if (proxies.length >= MAX_PROXY_TEST) return tooMany;
      try {
        parseProxySpec(line);
      } catch (e) {
        return { proxies: [], error: `Line ${n + 1}: ${(e as Error).message}` };
      }
      proxies.push(line);
      continue;
    }
    const first = Number(m[2]);
    const last = Number(m[3]);
    if (first < 1 || last > 65535 || first > last) {
      return { proxies: [], error: `Line ${n + 1}: ${m[2]}-${m[3]} is not a range of ports.` };
    }
    if (proxies.length + (last - first + 1) > MAX_PROXY_TEST) return tooMany;
    try {
      parseProxySpec(`${m[1]}${first}${m[4]}`);
    } catch (e) {
      return { proxies: [], error: `Line ${n + 1}: ${(e as Error).message}` };
    }
    for (let port = first; port <= last; port++) proxies.push(`${m[1]}${port}${m[4]}`);
  }
  return { proxies };
}

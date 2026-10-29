// Proxy tester (testing/test-suite.md, steps 1 to 5): the safety check every start runs,
// location, speed, a sticky re-check and IP-database reputation, for many proxies.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describeProxy, judgeProxyCheck, type RawProxyCheck } from './proxy.js';
import type { ProxyInput } from '@enclave/shared';

/** What the tester records for one proxy. */
export interface ProxyTestResult {
  proxy: string;
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
  /** ip-api.com: city, ISP and its flags. Only the IP address is sent. */
  city?: string;
  isp?: string;
  asn?: string;
  hosting?: boolean;
  proxyFlag?: boolean;
  mobile?: boolean;
  /** Lower is better: failing, flagged or unsticky proxies sort last. */
  score: number;
}

export interface ProxyTestJob {
  id: string;
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  total: number;
  checked: number;
  /** "first check", "waiting for the sticky check", "sticky check", "reputation". */
  phase: string;
  results?: ProxyTestResult[];
  reportDir?: string;
  /** The summary table, best first (also in the report folder). */
  table?: string;
  error?: string;
}

export interface ProxyTestOptions {
  /** Minutes between the two checks; 0 skips the sticky check. */
  stickyMinutes: number;
}

type Check = (proxy: ProxyInput) => Promise<RawProxyCheck>;

const PARALLEL = 5;
const IP_API_BATCH = 100;
const IP_API_FIELDS = 'query,status,city,isp,as,mobile,proxy,hosting';

export class ProxyTester {
  private readonly jobs = new Map<string, ProxyTestJob>();

  constructor(
    private readonly check: Check,
    private readonly reportsDir: string,
  ) {}

  start(proxies: ProxyInput[], options: ProxyTestOptions): ProxyTestJob {
    const job: ProxyTestJob = {
      id: randomBytes(8).toString('hex'),
      state: 'running',
      startedAt: new Date().toISOString(),
      total: proxies.length,
      checked: 0,
      phase: 'first check',
    };
    this.jobs.set(job.id, job);
    this.run(job, proxies, options).then(
      (results) =>
        Object.assign(job, { state: 'done', results, finishedAt: new Date().toISOString() }),
      (e: unknown) =>
        Object.assign(job, {
          state: 'failed',
          finishedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        }),
    );
    return job;
  }

  get(id: string): ProxyTestJob | undefined {
    return this.jobs.get(id);
  }

  private async run(
    job: ProxyTestJob,
    proxies: ProxyInput[],
    options: ProxyTestOptions,
  ): Promise<ProxyTestResult[]> {
    const first = await this.checkAll(proxies, () => job.checked++);
    const results: ProxyTestResult[] = proxies.map((p, i) => fromCheck(p, first[i]!));

    if (options.stickyMinutes > 0) {
      job.phase = 'waiting for the sticky check';
      await new Promise((r) => setTimeout(r, options.stickyMinutes * 60_000));
      job.phase = 'sticky check';
      const working = results.map((r, i) => ({ r, p: proxies[i]! })).filter((x) => x.r.ok);
      const later = await this.checkAll(
        working.map((x) => x.p),
        () => {},
      );
      working.forEach(({ r }, i) => {
        const ip = later[i]?.exitIp;
        if (ip) r.exitIpLater = ip;
        r.sticky = ip !== undefined && ip === r.exitIp;
      });
    }

    job.phase = 'reputation';
    await addReputation(results);
    for (const r of results) r.score = score(r);
    results.sort((a, b) => a.score - b.score || (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));

    const dir = path.join(
      this.reportsDir,
      `${job.startedAt.replace(/[:.]/g, '-')}-proxy-test-${results.length}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
    await writeFile(path.join(dir, 'summary.txt'), `${proxyTestTable(results)}\n`);
    job.reportDir = dir;
    job.table = proxyTestTable(results);
    return results;
  }

  /** Runs the safety check on every proxy, PARALLEL at a time, in input order. */
  private async checkAll(proxies: ProxyInput[], onDone: () => void): Promise<RawProxyCheck[]> {
    const out: RawProxyCheck[] = new Array(proxies.length);
    let next = 0;
    const worker = async () => {
      while (next < proxies.length) {
        const i = next++;
        out[i] = await this.check(proxies[i]!).catch((e: unknown) => ({
          error: e instanceof Error ? e.message : String(e),
        }));
        onDone();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, proxies.length) }, worker));
    return out;
  }
}

function fromCheck(proxy: ProxyInput, raw: RawProxyCheck): ProxyTestResult {
  const verdict = judgeProxyCheck(raw);
  return {
    proxy: describeProxy(proxy),
    ok: verdict.ok,
    ...(verdict.ok ? {} : { problem: verdict.message }),
    ...(raw.exitIp ? { exitIp: raw.exitIp } : {}),
    ...(raw.country ? { country: raw.country } : {}),
    ...(raw.timezone ? { timezone: raw.timezone } : {}),
    ...(raw.latencyMs !== undefined ? { latencyMs: raw.latencyMs } : {}),
    score: 0,
  };
}

interface IpApiAnswer {
  query: string;
  status: string;
  city?: string;
  isp?: string;
  as?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

/** ip-api.com batch lookup (free tier: plain HTTP, 100 IPs per request). */
async function addReputation(results: ProxyTestResult[]): Promise<void> {
  const ips = [...new Set(results.map((r) => r.exitIp).filter((ip): ip is string => !!ip))];
  const answers = new Map<string, IpApiAnswer>();
  for (let i = 0; i < ips.length; i += IP_API_BATCH) {
    try {
      const res = await fetch(`http://ip-api.com/batch?fields=${IP_API_FIELDS}`, {
        method: 'POST',
        body: JSON.stringify(ips.slice(i, i + IP_API_BATCH)),
        signal: AbortSignal.timeout(20_000),
      });
      for (const a of (await res.json()) as IpApiAnswer[]) answers.set(a.query, a);
    } catch {
      // Reputation is extra information; the rest of the report stands without it.
    }
  }
  for (const r of results) {
    const a = r.exitIp ? answers.get(r.exitIp) : undefined;
    if (!a || a.status !== 'success') continue;
    if (a.city) r.city = a.city;
    if (a.isp) r.isp = a.isp;
    if (a.as) r.asn = a.as.split(' ')[0]!;
    if (a.hosting !== undefined) r.hosting = a.hosting;
    if (a.proxy !== undefined) r.proxyFlag = a.proxy;
    if (a.mobile !== undefined) r.mobile = a.mobile;
  }
}

function score(r: ProxyTestResult): number {
  if (!r.ok) return 1000;
  return (r.sticky === false ? 100 : 0) + (r.proxyFlag ? 10 : 0) + (r.hosting ? 10 : 0);
}

/** A plain-text table, best first. */
export function proxyTestTable(results: ProxyTestResult[]): string {
  const rows = results.map((r) => [
    r.ok ? 'OK' : 'FAILED',
    r.proxy.replace(/^\w+:\/\/[^@]*@/, ''),
    r.exitIp ?? '-',
    [r.country, r.city].filter(Boolean).join(' ') || '-',
    r.latencyMs !== undefined ? `${r.latencyMs} ms` : '-',
    r.sticky === undefined ? '-' : r.sticky ? 'sticky' : `changed to ${r.exitIpLater ?? '?'}`,
    r.proxyFlag === undefined ? '-' : r.proxyFlag ? 'PROXY' : 'clean',
    r.hosting === undefined ? '-' : r.hosting ? 'HOSTING' : 'clean',
    r.isp ?? r.problem ?? '-',
  ]);
  const head = [
    'result',
    'proxy',
    'exit IP',
    'location',
    'speed',
    'sticky',
    'proxy flag',
    'hosting',
    'ISP',
  ];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
}

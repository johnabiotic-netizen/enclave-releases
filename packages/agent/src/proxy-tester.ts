// Proxy tester (testing/test-suite.md, steps 1 to 5): the safety check every start runs,
// location, speed, a sticky re-check and IP-database reputation, for many proxies.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describeProxy, judgeProxyCheck, type RawProxyCheck } from './proxy.js';
import type { ProxyInput, ProxyReputation, ProxyTestJob, ProxyTestResult } from '@enclave/shared';

export type { ProxyTestJob, ProxyTestResult } from '@enclave/shared';

export interface ProxyTestOptions {
  /** Minutes between the two checks; 0 skips the sticky check. */
  stickyMinutes: number;
  /** Also run Enclave Scan for every proxy that passes the other checks (about 1.5 min each). */
  scan: boolean;
}

type Check = (proxy: ProxyInput) => Promise<RawProxyCheck>;
/** Enclave Scan's verdict and proxy card for one proxy. */
export type ScanCheck = (proxy: ProxyInput) => Promise<{ verdict: string; proxy: string }>;

const PARALLEL = 5;
const IP_API_BATCH = 100;
const IP_API_FIELDS = 'query,status,city,isp,as,mobile,proxy,hosting';

export class ProxyTester {
  private readonly jobs = new Map<string, ProxyTestJob>();

  constructor(
    private readonly check: Check,
    private readonly reportsDir: string,
    private readonly scan: ScanCheck,
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
    // Every row from the start, filled in as its check finishes, so a client sees progress.
    const results: ProxyTestResult[] = proxies.map((p, index) => ({
      index,
      proxy: describeProxy(p),
      pending: true,
      ok: false,
      score: 0,
    }));
    job.results = results;
    await this.checkAll(proxies, (i, raw) => {
      results[i] = fromCheck(i, proxies[i]!, raw);
      job.checked++;
    });

    // Reputation before the sticky wait, so the table is useful while it waits.
    job.phase = 'reputation';
    await addReputation(results);

    if (options.stickyMinutes > 0 && results.some((r) => r.ok)) {
      job.phase = 'waiting for the sticky check';
      const wait = options.stickyMinutes * 60_000;
      job.stickyAt = new Date(Date.now() + wait).toISOString();
      await new Promise((r) => setTimeout(r, wait));
      delete job.stickyAt;
      job.phase = 'sticky check';
      const working = results.map((r, i) => ({ r, p: proxies[i]! })).filter((x) => x.r.ok);
      await this.checkAll(
        working.map((x) => x.p),
        (i, raw) => {
          const r = working[i]!.r;
          if (raw.exitIp) r.exitIpLater = raw.exitIp;
          r.sticky = raw.exitIp !== undefined && raw.exitIp === r.exitIp;
        },
      );
    }

    if (options.scan) {
      // One at a time: each is a browser start and a page scan, about 1.5 minutes.
      const candidates = results
        .map((r, i) => ({ r, p: proxies[i]! }))
        .filter((x) => x.r.ok && x.r.sticky !== false);
      job.phase = 'scan';
      job.checked = 0;
      job.total = candidates.length;
      for (const { r, p } of candidates) {
        // A second try after a pause: a busy line or a slow proxy moment is common.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const v = await this.scan(p);
            r.scan = v.verdict;
            r.scanProxy = v.proxy;
            break;
          } catch (e) {
            r.scan = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
            if (attempt === 1) await new Promise((res) => setTimeout(res, 15_000));
          }
        }
        job.checked++;
      }
    }

    for (const r of results) r.score = score(r);
    // A copy, sorted: the job's rows stay in request order until the job is done.
    const sorted = [...results];
    sorted.sort((a, b) => a.score - b.score || (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));

    const dir = path.join(
      this.reportsDir,
      `${job.startedAt.replace(/[:.]/g, '-')}-proxy-test-${sorted.length}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'results.json'), JSON.stringify(sorted, null, 2));
    await writeFile(path.join(dir, 'summary.txt'), `${proxyTestTable(sorted)}\n`);
    job.reportDir = dir;
    job.table = proxyTestTable(sorted);
    return sorted;
  }

  /** Runs the safety check on every proxy, PARALLEL at a time; each result as it comes. */
  private async checkAll(
    proxies: ProxyInput[],
    onDone: (index: number, raw: RawProxyCheck) => void,
  ): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < proxies.length) {
        const i = next++;
        const raw = await this.check(proxies[i]!).catch((e: unknown): RawProxyCheck => ({
          error: e instanceof Error ? e.message : String(e),
        }));
        onDone(i, raw);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, proxies.length) }, worker));
  }
}

function fromCheck(index: number, proxy: ProxyInput, raw: RawProxyCheck): ProxyTestResult {
  const verdict = judgeProxyCheck(raw);
  return {
    index,
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

/**
 * ip-api.com batch lookup (free tier: plain HTTP, 100 IPs per request). Only IP addresses are
 * sent. IPs it couldn't look up are missing from the map; reputation is extra information.
 */
export async function lookupReputation(ips: string[]): Promise<Map<string, ProxyReputation>> {
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
  const out = new Map<string, ProxyReputation>();
  for (const [ip, a] of answers) {
    if (a.status !== 'success') continue;
    out.set(ip, {
      ...(a.city ? { city: a.city } : {}),
      ...(a.isp ? { isp: a.isp } : {}),
      ...(a.as ? { asn: a.as.split(' ')[0]! } : {}),
      ...(a.hosting !== undefined ? { hosting: a.hosting } : {}),
      ...(a.proxy !== undefined ? { proxy: a.proxy } : {}),
      ...(a.mobile !== undefined ? { mobile: a.mobile } : {}),
    });
  }
  return out;
}

async function addReputation(results: ProxyTestResult[]): Promise<void> {
  const ips = [...new Set(results.map((r) => r.exitIp).filter((ip): ip is string => !!ip))];
  const found = await lookupReputation(ips);
  for (const r of results) {
    const a = r.exitIp ? found.get(r.exitIp) : undefined;
    if (!a) continue;
    if (a.city) r.city = a.city;
    if (a.isp) r.isp = a.isp;
    if (a.asn) r.asn = a.asn;
    if (a.hosting !== undefined) r.hosting = a.hosting;
    if (a.proxy !== undefined) r.proxyFlag = a.proxy;
    if (a.mobile !== undefined) r.mobile = a.mobile;
  }
}

function score(r: ProxyTestResult): number {
  if (!r.ok) return 1000;
  return (
    (r.sticky === false ? 100 : 0) +
    (r.scan !== undefined && r.scan !== 'consistent' ? 50 : 0) +
    (r.proxyFlag ? 10 : 0) +
    (r.hosting ? 10 : 0)
  );
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
    r.scan === undefined
      ? '-'
      : r.scan === 'consistent'
        ? 'consistent'
        : `${r.scan}${r.scanProxy ? ` (${r.scanProxy})` : ''}`,
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
    'scan',
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

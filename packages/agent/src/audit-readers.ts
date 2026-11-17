// Turns an audit run's raw page results into findings (testing/test-suite.md). Each
// reader looks for exact fields; a field it cannot find is "look" (a person checks the
// screenshot), never a guess.
import type { Finding, Verdict } from '@enclave/shared';
import type { AuditCheckResult, AuditReport } from './profiles.js';

export type { Finding, Verdict } from '@enclave/shared';

/** Real Windows Firefox of Camoufox's version on this PC (testing/reference/). */
export interface Reference {
  probe?: Record<string, unknown> | undefined;
  metrics?: Record<string, number[]> | undefined;
  svgEmojiCurrentFont?: { groupSum: number } | undefined;
  creepjs?:
    | {
        webglParams?: string;
        webglExts?: string;
        audioSum?: string;
        domRectElems?: string;
      }
    | undefined;
}

export interface AuditContext {
  /** The exit IP the proxy check saw just before the run. */
  exitIp: string | null;
  /** The profile's saved probe baseline (scripts/fingerprint/baseline.mjs), if any. */
  baseline?: Record<string, unknown> | undefined;
  reference: Reference;
  /** Set by evaluateAudit from the run's probe. */
  hardware?: Hardware;
}

/** Probe fields that differ between machines or runs, so never compared with the reference. */
const NOT_COMPARABLE_WITH_REFERENCE = [
  'takenAt',
  'navigator.webdriver',
  'navigator.language',
  'navigator.languages',
  'screen.',
  'time.',
  'canvas.',
  'mediaDevices',
  // The profile's language decides which Windows voices exist (German: Hedda, Katja, Stefan).
  'voices',
];

export function evaluateAudit(report: AuditReport, ctx: AuditContext): Finding[] {
  const findings: Finding[] = [];
  if (report.error) {
    findings.push({ check: 'audit', item: 'run', verdict: 'fail', note: report.error.slice(-300) });
  }
  const withHardware: AuditContext = { ...ctx, hardware: hardwareOf(report, ctx.reference) };
  for (const check of report.checks ?? []) {
    if (check.status !== 'ok') {
      findings.push({
        check: check.name,
        item: 'page',
        verdict: 'look',
        note: `The page gave no result: ${check.error ?? 'unknown error'}`,
      });
      continue;
    }
    const reader = READERS[check.name];
    findings.push(...(reader ? reader(check, withHardware) : []));
  }
  return findings;
}

/**
 * Whether this PC has the hardware the Windows Firefox reference was measured on (the
 * owner's PC). Graphics and processor values are a real PC's own: a profile claims the
 * graphics card and core count it runs on, so on any other PC they differ from the
 * reference by design, and comparing them would only report the hardware.
 */
function hardwareOf(report: AuditReport, reference: Reference): Hardware {
  const probe = report.checks?.find((c) => c.name === 'probe' && c.status === 'ok');
  if (!probe?.data || !reference.probe) return { gpu: null, cpu: null };
  const a = flatten(probe.data as Record<string, unknown>);
  const e = flatten(reference.probe);
  const renderer = a.get('webgl.renderer');
  const refRenderer = e.get('webgl.renderer');
  return {
    gpu: renderer !== undefined && renderer === refRenderer,
    cpu: a.get('navigator.hardwareConcurrency') === e.get('navigator.hardwareConcurrency'),
    renderer: renderer === undefined ? undefined : String(renderer),
    refRenderer: refRenderer === undefined ? undefined : String(refRenderer),
  };
}

interface Hardware {
  /** Same graphics card as the reference; null when no probe ran to tell. */
  gpu: boolean | null;
  cpu: boolean | null;
  renderer?: string | undefined;
  refRenderer?: string | undefined;
}

/** Probe keys that belong to the PC's hardware rather than to the browser. */
function hardwareKey(key: string, hw: Hardware): boolean {
  if (hw.gpu !== true && (key.startsWith('webgl.') || key.startsWith('webgl2.'))) return true;
  if (hw.cpu !== true && key === 'navigator.hardwareConcurrency') return true;
  return false;
}

const READERS: Record<string, (c: AuditCheckResult, ctx: AuditContext) => Finding[]> = {
  probe: readProbe,
  metrics: readMetrics,
  'svg-emoji': readSvgEmoji,
  scan: readPixelscan,
  deep: readCreepJs,
  leak: readBrowserLeaksWebRtc,
  draw: readBrowserLeaksCanvas,
  crowd: readAmiUnique,
};

function readProbe(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const data = c.data as Record<string, unknown>;
  const out: Finding[] = [];
  const canvas = data.canvas as { first?: string; second?: string } | undefined;
  out.push({
    check: 'probe',
    item: 'canvas stable within a page',
    verdict: canvas?.first && canvas.first === canvas.second ? 'pass' : 'fail',
    value: `${canvas?.first} / ${canvas?.second}`,
  });
  if (ctx.reference.probe) {
    const hw = ctx.hardware ?? { gpu: null, cpu: null };
    out.push(
      ...compareFlat(
        'probe',
        'Windows Firefox',
        data,
        ctx.reference.probe,
        (k) =>
          NOT_COMPARABLE_WITH_REFERENCE.some((p) => k === p || k.startsWith(p)) ||
          hardwareKey(k, hw),
      ),
    );
    if (hw.gpu === false || hw.cpu === false) {
      out.push({
        check: 'probe',
        item: 'graphics and processor',
        verdict: 'info',
        ...(hw.renderer ? { value: hw.renderer } : {}),
        note: "This PC's hardware differs from the PC the Windows Firefox reference was measured on, so graphics and processor values are this PC's own and aren't compared with it. The baseline still checks they never change.",
      });
    }
  }
  if (ctx.baseline) {
    out.push(
      ...compareFlat(
        'probe',
        'baseline',
        data,
        ctx.baseline,
        (k) => k === 'takenAt' || k.startsWith('canvas.'),
      ),
    );
  } else {
    out.push({ check: 'probe', item: 'baseline', verdict: 'info', note: 'No saved baseline yet.' });
  }
  return out;
}

/** One finding per differing field, or one pass for all of them. */
function compareFlat(
  check: string,
  against: string,
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  skip: (key: string) => boolean,
): Finding[] {
  const a = flatten(actual);
  const e = flatten(expected);
  const out: Finding[] = [];
  let compared = 0;
  for (const [key, want] of e) {
    if (skip(key)) continue;
    compared++;
    const got = a.get(key);
    if (got !== want) {
      out.push({
        check,
        item: `${key} vs ${against}`,
        verdict: 'fail',
        value: got ?? '(missing)',
        expected: want,
      });
    }
  }
  if (!out.length) {
    out.push({ check, item: `all ${compared} values vs ${against}`, verdict: 'pass' });
  }
  return out;
}

function flatten(o: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) {
      for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv);
    }
  } else {
    out.set(prefix.slice(0, -1), JSON.stringify(o));
  }
  return out;
}

const METRIC_COLUMNS = [
  'width',
  'glyph ascent',
  'glyph descent',
  'font ascent',
  'font descent',
  'span width',
  'span height',
  'svg y',
  'svg height',
];

function readMetrics(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const data = c.data as Record<string, number[]>;
  const ref = ctx.reference.metrics;
  if (!ref)
    return [{ check: 'metrics', item: 'reference', verdict: 'look', note: 'No reference.' }];
  const out: Finding[] = [];
  let same = 0;
  for (const [font, want] of Object.entries(ref)) {
    const got = data[font];
    want.forEach((w, i) => {
      if (got?.[i] === w) {
        same++;
      } else {
        out.push({
          check: 'metrics',
          item: `${font}: ${METRIC_COLUMNS[i] ?? i}`,
          verdict: 'fail',
          value: String(got?.[i]),
          expected: String(w),
        });
      }
    });
  }
  if (!out.length)
    out.push({ check: 'metrics', item: `all ${same} values vs Windows Firefox`, verdict: 'pass' });
  return out;
}

function readSvgEmoji(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const data = c.data as { groupSum: number };
  const want = ctx.reference.svgEmojiCurrentFont?.groupSum;
  return [
    {
      check: 'svg-emoji',
      item: 'group bounds sum (CreepJS SVGRect)',
      verdict: want === undefined ? 'look' : data.groupSum === want ? 'pass' : 'fail',
      value: String(data.groupSum),
      ...(want === undefined ? {} : { expected: String(want) }),
      note: 'Windows Firefox with the same Segoe UI Emoji as the profile.',
    },
  ];
}

/** The line after `label` in a page's text, if any. */
function after(text: string, label: RegExp): string | null {
  const m = text.match(new RegExp(`${label.source}\\s*\\n\\s*([^\\n]+)`));
  return m?.[1]?.trim() ?? null;
}

function readPixelscan(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const t = c.text ?? '';
  const out: Finding[] = [];
  const verdict = t.match(/Your Browser Fingerprint is\s+(consistent|inconsistent)/)?.[1];
  out.push({
    check: 'scan',
    item: 'verdict',
    verdict: verdict === 'consistent' ? 'pass' : verdict ? 'fail' : 'look',
    value: verdict ?? '(not found)',
  });
  const cards: [string, RegExp, RegExp][] = [
    ['proxy', /No proxy detected/, /Proxy detected/],
    ['masking', /No masking detected/, /Masking detected/],
    ['automation', /No automated behavior detected/, /Automated behavior detected/],
  ];
  for (const [item, good, bad] of cards) {
    out.push({
      check: 'scan',
      item,
      verdict: good.test(t) ? 'pass' : bad.test(t) ? 'fail' : 'look',
      value: t.match(good)?.[0] ?? t.match(bad)?.[0] ?? '(not found)',
    });
  }
  const browser = t.match(/\n([^\n]+ on [^\n]+)\s*\n\s*Browser\s*\n/)?.[1]?.trim();
  out.push({
    check: 'scan',
    item: 'browser',
    verdict: browser ? (/Firefox [\d.]+ on Windows/.test(browser) ? 'pass' : 'fail') : 'look',
    value: browser ?? '(not found)',
  });
  const ip = after(t, /IP Address/);
  const webrtc = after(t, /WebRTC IP Address/);
  if (ip || webrtc) {
    out.push({
      check: 'scan',
      item: 'WebRTC IP equals IP',
      verdict:
        ip && webrtc && ip === webrtc && (!ctx.exitIp || ip === ctx.exitIp) ? 'pass' : 'fail',
      value: `IP ${ip}, WebRTC ${webrtc}`,
      ...(ctx.exitIp ? { expected: ctx.exitIp } : {}),
    });
  }
  const type = after(t, /User Type by IP/);
  if (type) out.push({ check: 'scan', item: 'IP type', verdict: 'info', value: type });
  return out;
}

function readCreepJs(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const t = c.text ?? '';
  const ref = ctx.reference.creepjs ?? {};
  const out: Finding[] = [];
  const lies = Array.isArray(c.extra) ? c.extra.map(String) : [];
  out.push({
    check: 'deep',
    item: 'lies',
    verdict: lies.length ? 'fail' : 'pass',
    value: lies.length ? lies.join('; ') : 'none',
  });
  const same = (item: string, value: string | null | undefined, want: string | undefined) =>
    out.push({
      check: 'deep',
      item,
      verdict: !value ? 'look' : want === undefined ? 'info' : value === want ? 'pass' : 'fail',
      value: value ?? '(not found)',
      ...(want === undefined ? {} : { expected: want }),
    });
  // Graphics hashes only on the reference's own graphics card (hardwareOf).
  const sameGpu = ctx.hardware?.gpu === true;
  same(
    'WebGL params',
    t.match(/params \(\d+\): (\w+)/)?.[1],
    sameGpu ? ref.webglParams : undefined,
  );
  same(
    'WebGL extensions',
    t.match(/exts \(\d+\): (\w+)/)?.[1],
    sameGpu ? ref.webglExts : undefined,
  );
  same('audio sum', t.match(/sum: ([\d.]+)/)?.[1], ref.audioSum);
  same('DOMRect', t.match(/elems A: ([\d.]+)/)?.[1], ref.domRectElems);
  for (const [item, re] of [
    ['headless', /(\d+)% headless:/],
    ['stealth', /(\d+)% stealth:/],
  ] as const) {
    const pct = t.match(re)?.[1];
    out.push({
      check: 'deep',
      item,
      verdict: pct === undefined ? 'look' : pct === '0' ? 'pass' : 'fail',
      value: pct === undefined ? '(not found)' : `${pct}%`,
    });
  }
  const like = t.match(/(\d+)% like headless:/)?.[1];
  if (like !== undefined) {
    out.push({ check: 'deep', item: 'like headless', verdict: 'info', value: `${like}%` });
  }
  const fonts = t.match(/load \(\d+\/\d+\): ([^\n]+)/)?.[1];
  out.push({
    check: 'deep',
    item: 'fonts',
    verdict: !fonts ? 'look' : /Like Windows/.test(fonts) ? 'pass' : 'fail',
    value: fonts ?? '(not found)',
  });
  const device = t.match(/device:\s*\n\s*Windows \(Win32\)\s*\n\s*([^\n]+)/)?.[1];
  out.push({
    check: 'deep',
    item: 'worker device',
    verdict: !device ? 'look' : /^Windows/.test(device) ? 'pass' : 'fail',
    value: device ?? '(not found)',
  });
  const rtc = t.match(/\nip: ([\d.]+)/)?.[1];
  out.push({
    check: 'deep',
    item: 'WebRTC IP',
    verdict: !rtc ? 'look' : !ctx.exitIp || rtc === ctx.exitIp ? 'pass' : 'fail',
    value: rtc ?? '(not found)',
    ...(ctx.exitIp ? { expected: ctx.exitIp } : {}),
  });
  return out;
}

function readBrowserLeaksWebRtc(c: AuditCheckResult, ctx: AuditContext): Finding[] {
  const t = c.text ?? '';
  const field = (label: string) => t.match(new RegExp(`${label}\\t([^\\n]*)`))?.[1]?.trim() ?? null;
  const remote = field('IPv4 Address');
  const pub = field('Public IP Address');
  const local = field('Local IP Address');
  // The result row: "WebRTC Leak Test", an icon line, then "No Leak" (or the leak) before
  // "Local IP Address". The site's menu also says "WebRTC Leak Test" (2026-11), so the row is
  // the last one before "Local IP Address", and a verdict word is all that counts.
  const beforeLocal = t.split('Local IP Address')[0] ?? '';
  const row = beforeLocal.slice(
    beforeLocal.lastIndexOf('WebRTC Leak Test') + 'WebRTC Leak Test'.length,
  );
  const leak = /no leak/i.test(row)
    ? 'No Leak'
    : (row.match(/\b(Leak(?:ed| detected)?)\b[^\n]*/i)?.[0]?.trim() ?? null);
  const exit = ctx.exitIp;
  return [
    {
      check: 'leak',
      item: 'IP',
      verdict: !remote ? 'look' : !exit || remote === exit ? 'pass' : 'fail',
      value: remote ?? '(not found)',
      ...(exit ? { expected: exit } : {}),
    },
    {
      check: 'leak',
      item: 'WebRTC public IP',
      verdict: !pub ? 'look' : !exit || pub === exit ? 'pass' : 'fail',
      value: pub ?? '(not found)',
      ...(exit ? { expected: exit } : {}),
    },
    {
      check: 'leak',
      item: 'no local IP',
      verdict: local === null ? 'look' : local === '' || local === '-' ? 'pass' : 'fail',
      value: local || '(none)',
    },
    {
      check: 'leak',
      item: 'leak test',
      // No verdict word on the page: the public and local IP lines above decide.
      verdict: leak === 'No Leak' ? 'pass' : leak ? 'fail' : 'info',
      value: leak ?? '(no verdict shown)',
      ...(leak ? {} : { note: 'BrowserLeaks showed no verdict; the IP lines decide.' }),
    },
  ];
}

function readBrowserLeaksCanvas(c: AuditCheckResult): Finding[] {
  const sig = (c.text ?? '').match(/Signature\s+([0-9A-F]{32})/)?.[1];
  return [
    {
      check: 'draw',
      item: 'signature',
      verdict: sig ? 'info' : 'look',
      value: sig ?? '(not found)',
      note: 'Must differ from every other profile (compared across reports).',
    },
  ];
}

function readAmiUnique(c: AuditCheckResult): Finding[] {
  const t = c.text ?? '';
  const os = t.match(/\n([^\n]+)\nOperating system\n/)?.[1]?.trim();
  const browser = t.match(/\n([^\n]+)\nWeb browser\n/)?.[1]?.trim();
  const lang = t.match(/\n([^\n]+)\nLanguage\n/)?.[1]?.trim();
  const tz = t.match(/\n([^\n]+)\nTimezone\n/)?.[1]?.trim();
  return [
    {
      check: 'crowd',
      item: 'operating system',
      verdict: !os ? 'look' : os.toLowerCase() === 'windows' ? 'pass' : 'fail',
      value: os ?? '(not found)',
    },
    {
      check: 'crowd',
      item: 'browser',
      verdict: !browser ? 'look' : browser.toLowerCase() === 'firefox' ? 'pass' : 'fail',
      value: browser ?? '(not found)',
    },
    { check: 'crowd', item: 'language', verdict: 'info', value: lang ?? '(not found)' },
    { check: 'crowd', item: 'timezone', verdict: 'info', value: tz ?? '(not found)' },
  ];
}

/** A short text report: counts, then everything that is not a pass. */
export function summarize(name: string, exitIp: string | null, findings: Finding[]): string {
  const count = (v: Verdict) => findings.filter((f) => f.verdict === v).length;
  const lines = [
    `Audit of "${name}" (exit IP ${exitIp ?? 'unknown'})`,
    `${count('pass')} passed, ${count('fail')} failed, ${count('look')} to look at, ${count('info')} for information.`,
    '',
  ];
  const shownPerCheck = 6;
  for (const v of ['fail', 'look', 'info'] as const) {
    const shown = new Map<string, number>();
    for (const f of findings.filter((x) => x.verdict === v)) {
      const n = (shown.get(f.check) ?? 0) + 1;
      shown.set(f.check, n);
      if (n === shownPerCheck + 1) {
        const all = findings.filter((x) => x.verdict === v && x.check === f.check).length;
        lines.push(
          `${v.toUpperCase().padEnd(5)} ${f.check}: ... and ${all - shownPerCheck} more (findings.json)`,
        );
      }
      if (n > shownPerCheck) continue;
      lines.push(
        `${v.toUpperCase().padEnd(5)} ${f.check}: ${f.item}` +
          (f.value !== undefined ? ` = ${f.value}` : '') +
          (f.expected !== undefined ? ` (expected ${f.expected})` : '') +
          (f.note ? ` [${f.note}]` : ''),
      );
    }
  }
  return lines.join('\n');
}

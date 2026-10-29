import { describe, expect, it } from 'vitest';
import { evaluateAudit, summarize } from './audit-readers.js';
import type { AuditCheckResult, AuditReport } from './profiles.js';

// Excerpts of page text as the audit captured it on 2026-10-29 (Profile 3).
const PIXELSCAN = `Fingerprint Scan
Restart
Your Browser Fingerprint is consistent
Learn More
Firefox 158.0 on Windows

Browser
Check Geo API
United States / Newark
Location
No proxy detected
Proxy
No masking detected
Fingerprint
No automated behavior detected
Bot check
Location
IP Address
72.245.68.75
WebRTC IP Address
72.245.68.75
Country
United States
User Type by IP
hosting
`;

const CREEPJS = `FP ID: 05f0f0260a1bd004c8a1e003ef0ea698bdb1c94b0cb2d78173370dffa69b2d1f
WebRTC90f110d0
foundation/ip:
type & base ip: 0
ip: 72.245.68.75
Headlesse9d45bc0
chromium: false
6% like headless: 7bca6f28
0% headless: 52defe05
0% stealth: 0c019315
device:
Windows (Win32)
Windows 10 (64-bit)
cores: 4
WebGLf1d3e338
params (78): 94e7c936
exts (45): 71e0d43d
Fonts5ca8193e
load (13/51): Like Windows 11
DOMRect51db1c48
elems A: 0.4950627700024415
Audio17546399
sum: 35.749972093850374
`;

const WEBRTC = `Your Remote IP
IPv4 Address\t72.245.68.75
IPv6 Address\t
Your WebRTC IP
WebRTC Leak Test\t
✔
No Leak
Local IP Address\t-
Public IP Address\t72.245.68.75
Session Description
`;

const AMIUNIQUE = `Yes! You are unique among the 5638544 fingerprints in our entire dataset.
The following informations reveal your OS, browser.
windows
Operating system
44.76 %
firefox
Web browser
33.82 %
en
Language
`;

const check = (name: string, text: string, extra?: unknown): AuditCheckResult => ({
  name,
  url: '',
  status: 'ok',
  text,
  seconds: 1,
  ...(extra === undefined ? {} : { extra }),
});

const reference = {
  creepjs: {
    webglParams: '94e7c936',
    webglExts: '71e0d43d',
    audioSum: '35.749972093850374',
    domRectElems: '0.4950627700024415',
  },
};

function run(checks: AuditCheckResult[], exitIp = '72.245.68.75') {
  const report: AuditReport = { startedAt: '', finishedAt: '', checks };
  return evaluateAudit(report, { exitIp, reference });
}

describe('audit readers', () => {
  it('passes a clean Pixelscan, CreepJS, BrowserLeaks and amiunique run', () => {
    const findings = run([
      check('pixelscan', PIXELSCAN),
      check('creepjs', CREEPJS, []),
      check('browserleaks-webrtc', WEBRTC),
      check('amiunique', AMIUNIQUE),
    ]);
    const notPassing = findings.filter((f) => f.verdict === 'fail' || f.verdict === 'look');
    expect(notPassing).toEqual([]);
    expect(findings.find((f) => f.item === 'IP type')?.value).toBe('hosting');
  });

  it('fails what a leaking or flagged profile shows', () => {
    const findings = run(
      [
        check('pixelscan', PIXELSCAN.replace('No proxy detected', 'Proxy detected')),
        check('creepjs', CREEPJS.replace('params (78): 94e7c936', 'params (78): deadbeef'), [
          'WebGL',
        ]),
        check(
          'browserleaks-webrtc',
          WEBRTC.replace('Local IP Address\t-', 'Local IP Address\t192.168.1.5'),
        ),
      ],
      '72.245.68.75',
    );
    const failed = findings.filter((f) => f.verdict === 'fail').map((f) => `${f.check}: ${f.item}`);
    expect(failed).toEqual(
      expect.arrayContaining([
        'pixelscan: proxy',
        'creepjs: lies',
        'creepjs: WebGL params',
        'browserleaks-webrtc: no local IP',
      ]),
    );
  });

  it('fails when WebRTC shows another IP than the exit IP', () => {
    const findings = run([check('creepjs', CREEPJS, [])], '198.145.172.41');
    expect(findings.find((f) => f.item === 'WebRTC IP')?.verdict).toBe('fail');
  });

  it('says "look", not pass, when a page changed and a field is gone', () => {
    const findings = run([check('pixelscan', 'Pixelscan has a new design')]);
    expect(findings.find((f) => f.item === 'verdict')?.verdict).toBe('look');
    expect(findings.some((f) => f.verdict === 'pass')).toBe(false);
  });

  it('summarizes counts and lists what did not pass', () => {
    const text = summarize('Profile 3', '72.245.68.75', [
      { check: 'pixelscan', item: 'proxy', verdict: 'fail', value: 'Proxy detected' },
      { check: 'creepjs', item: 'lies', verdict: 'pass', value: 'none' },
    ]);
    expect(text).toContain('1 passed, 1 failed');
    expect(text).toContain('FAIL  pixelscan: proxy = Proxy detected');
  });
});

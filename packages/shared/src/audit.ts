// The profile audit (testing/test-suite.md): check pages run in a throwaway copy of a profile,
// read into findings. Shared so the Windows app can show them.

export type Verdict = 'pass' | 'fail' | 'look' | 'info';

export interface Finding {
  check: string;
  item: string;
  verdict: Verdict;
  value?: string;
  expected?: string;
  note?: string;
}

/** The checks, in the order the app lists them. */
export const AUDIT_CHECKS = [
  {
    id: 'probe',
    label: 'Browser values',
    about:
      "Screen, time zone, graphics, audio, fonts and more, against this profile's baseline and real Windows Firefox.",
  },
  {
    id: 'metrics',
    label: 'Text measurements',
    about: 'How wide common Windows fonts draw, against real Windows Firefox.',
  },
  {
    id: 'svg-emoji',
    label: 'Emoji drawing',
    about: 'The size of drawn emoji, a value some sites compare.',
  },
  {
    id: 'pixelscan',
    label: 'Pixelscan',
    about: 'Its overall verdict, and whether it spots the proxy or masking.',
  },
  {
    id: 'creepjs',
    label: 'CreepJS',
    about: 'Lies it detects, its headless score, graphics and fonts.',
  },
  {
    id: 'browserleaks-webrtc',
    label: 'WebRTC leak',
    about: 'BrowserLeaks: that WebRTC shows only the proxy IP, no local address.',
  },
  {
    id: 'browserleaks-canvas',
    label: 'Canvas',
    about: 'BrowserLeaks: the canvas signature, which differs per profile.',
  },
  {
    id: 'amiunique',
    label: 'AmIUnique',
    about: 'The system, browser, language and time zone it detects.',
  },
] as const;

/** GET /audits/:jobId, as the app reads it (the agent's job also carries the raw report). */
export interface AuditJobView {
  id: string;
  profileId: string;
  checks: string[];
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  run?: {
    reportDir: string;
    exitIp: string | null;
    findings: Finding[];
    summary: string;
  };
}

// POST /profiles/:id/audit (202, then poll GET /audits/:jobId)
export interface StartAuditRequest {
  /** Check ids from AUDIT_CHECKS; none means all. */
  checks?: string[];
  /** Save this run's browser values as the profile's baseline. */
  saveBaseline?: boolean;
}

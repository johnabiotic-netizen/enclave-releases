// Words and numbers for the screens, in the copy rules' voice (ui/copy-guidelines.md).

import type { Profile, ProfileState } from '@enclave/shared';

/** What the user sees for a state; an action in progress overrides the agent's state. */
export type ShownState = ProfileState | 'stopping';

export const STATE_WORD: Record<ShownState, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  error: 'Error',
};

/** The seam's colour class for a state. */
export const SEAM: Record<ShownState, string> = {
  stopped: 'seam-stopped',
  starting: 'seam-busy',
  stopping: 'seam-busy',
  running: 'seam-running',
  error: 'seam-error',
};

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return regions.of(code.toUpperCase());
  } catch {
    return code;
  }
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function lastUsed(profile: Profile): string {
  const at = profile.status.lastStartedAt;
  if (!at) return 'Not used yet';
  const seconds = (Date.parse(at) - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size)
      return `Used ${relative.format(Math.round(seconds / size), unit)}`;
  }
  return 'Used just now';
}

export function exitIp(profile: Profile): string | undefined {
  return profile.proxy.lastCheck?.exitIp;
}

export function country(profile: Profile): string | undefined {
  return profile.proxy.lastCheck?.country;
}

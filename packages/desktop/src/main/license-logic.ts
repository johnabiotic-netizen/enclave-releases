// What a license key and the relay's answers add up to (specs/license.md). Pure: no Electron, no network.

import {
  type LicenseCheckResponse,
  type LicenseProblem,
  type LicenseStatus,
} from '@enclave/shared';
import type { VerifyResult } from '@enclave/agent';

/** How often the relay is asked, and how long the app keeps working without an answer. */
export const CHECK_EVERY_MS = 24 * 3600 * 1000;
export const GRACE_MS = 14 * 24 * 3600 * 1000;

export type Online = LicenseCheckResponse['status'] | 'unreachable';

export function needsCheck(lastGood: string | null, now: Date): boolean {
  return !lastGood || now.getTime() - Date.parse(lastGood) >= CHECK_EVERY_MS;
}

const PROBLEM: Record<Exclude<Online, 'ok' | 'unreachable'>, LicenseProblem> = {
  invalid: 'bad-signature',
  expired: 'expired',
  revoked: 'revoked',
  'other-pc': 'other-pc',
};

/**
 * `online` is what the relay said, 'unreachable' if it couldn't be asked, or null when no check was
 * due. Returns the status and the time of the last good check to keep.
 */
export function decide(input: {
  local: VerifyResult;
  online: Online | null;
  lastGood: string | null;
  now: Date;
}): { status: LicenseStatus; lastGood: string | null } {
  const { local, online, lastGood, now } = input;
  if (!local.ok) return { status: { licensed: false, problem: local.problem }, lastGood };
  const who = { name: local.payload.name, expires: local.payload.expires };
  if (online === 'ok') {
    const at = now.toISOString();
    return { status: { licensed: true, ...who, lastCheck: at }, lastGood: at };
  }
  if (online === null || online === 'unreachable') {
    // No answer (or none due): fine while the last good check is within the grace period.
    if (lastGood !== null && now.getTime() - Date.parse(lastGood) < GRACE_MS) {
      return { status: { licensed: true, ...who, lastCheck: lastGood }, lastGood };
    }
    return { status: { licensed: false, ...who, problem: 'unreachable' }, lastGood };
  }
  return { status: { licensed: false, ...who, problem: PROBLEM[online] }, lastGood: null };
}

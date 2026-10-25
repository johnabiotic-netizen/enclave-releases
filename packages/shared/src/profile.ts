// Matches specs/profile-schema.md and specs/schemas/profile.schema.json.

import type { Fingerprint } from './fingerprint.js';
import type { ProxyConfig } from './proxy.js';

export const DEFAULT_IDLE_STOP_MINUTES = 20;

export interface ProfileRuntime {
  idleStopMinutes?: number;
  screenMatchesFingerprint?: boolean;
}

export const PROFILE_STATES = ['stopped', 'starting', 'running', 'error'] as const;
export type ProfileState = (typeof PROFILE_STATES)[number];

/** Runtime only. May be rewritten freely. */
export interface ProfileStatus {
  state: ProfileState;
  containerId: string | null;
  streamPort: number | null;
  lastError: string | null;
  lastStartedAt: string | null;
}

export interface Profile {
  /** UUID v4. */
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  proxy: ProxyConfig;
  fingerprint: Fingerprint;
  runtime: ProfileRuntime;
  status: ProfileStatus;
}

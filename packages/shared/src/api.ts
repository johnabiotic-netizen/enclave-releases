// Request and response types for the local agent API (specs/agent-api.md).

import type { Profile } from './profile.js';
import type { ProxyCheckResult, ProxySpec } from './proxy.js';

export const DEFAULT_AGENT_PORT = 8787;
export const API_BASE_PATH = '/v1';

export const ERROR_CODES = [
  'DOCKER_DOWN',
  'PROXY_UNREACHABLE',
  'PROXY_LOCATION_MISMATCH',
  'IMAGE_NOT_BUILT',
  'GPU_UNAVAILABLE',
  'PROFILE_NOT_FOUND',
  'PROFILE_RUNNING',
  'PROFILE_NOT_RUNNING',
  'REAL_IP_LEAK_SUSPECTED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface OkResponse {
  ok: true;
}

// GET /health
export interface HealthResponse {
  ok: boolean;
  version: string;
  dockerOk: boolean;
}

// GET /profiles
export type ListProfilesResponse = Profile[];

// POST /profiles
export interface CreateProfileRequest {
  name: string;
  /** Required unless `useTestProxy` is true. */
  proxy?: ProxySpec;
  /** Device template id. */
  template?: string;
  useTestProxy?: boolean;
}
export type CreateProfileResponse = Profile;

// GET /profiles/:id
export type GetProfileResponse = Profile;

// PATCH /profiles/:id
export interface UpdateProfileRequest {
  name?: string;
  notes?: string;
  idleStopMinutes?: number;
  proxy?: ProxySpec;
}
export type UpdateProfileResponse = Profile;

// DELETE /profiles/:id?confirm=true
export interface DeleteProfileQuery {
  confirm: boolean;
}
export type DeleteProfileResponse = OkResponse;

// GET /profiles/:id/stream
export interface StreamInfo {
  url: string;
  /** Phone mode (Stage 2): the same stream over Tailscale, e.g. https://pc.tail1234.ts.net:52100/. */
  phoneUrl?: string;
  password: string;
  expiresAt: string;
}
export type GetStreamResponse = StreamInfo;

// POST /profiles/:id/start
export interface StartProfileResponse {
  stream: StreamInfo;
}

// POST /profiles/:id/stop
export type StopProfileResponse = OkResponse;

// POST /profiles/:id/check-proxy
export type CheckProxyResponse = ProxyCheckResult;

// GET /profiles/:id/logs?tail=200
export interface LogsQuery {
  tail?: number;
}
export interface LogsResponse {
  lines: string[];
}

// GET /system
export interface SystemResponse {
  ram: {
    totalBytes: number;
    freeBytes: number;
  };
  profilesRunning: number;
  dockerOk: boolean;
  virtualizationOk: boolean;
  imageBuilt: boolean;
}

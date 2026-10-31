// Request and response types for the local agent API (specs/agent-api.md).

import type { Profile } from './profile.js';
import type { ProxyCheckResult, ProxySpec } from './proxy.js';

export const DEFAULT_AGENT_PORT = 8787;
/** Where the Windows app's own pages come from (its app:// scheme); neko lets it in. */
export const DESKTOP_APP_ORIGIN = 'app://enclave';
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
  'FILE_PICKER_CLOSED',
  'SECRETS_LOCKED',
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

// GET /profiles/:id/media (Stage 4)
/** Whether a page in the profile is using its camera or microphone right now, and whether
 * it has a file picker open (the phone can fill it). */
export interface MediaInUse {
  camera: boolean;
  microphone: boolean;
  filePicker: boolean;
  /** A phone is sharing its camera into the profile now (frames under 3 s old). */
  phoneCamera: boolean;
  /** A phone is sharing its microphone into the profile now. */
  phoneMicrophone: boolean;
}
export type GetMediaResponse = MediaInUse;

// POST /profiles/:id/files?name=<file name>, body: the file (application/octet-stream)
/** Stage 4: the largest file the phone can put into the profile's file picker. */
export const MAX_PHONE_FILE_BYTES = 100 * 1024 * 1024;
export type SendFileResponse = OkResponse;

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
  /** A built-in test proxy is set up (TEST_PROXY), so profiles can be made without one. */
  testProxyAvailable: boolean;
}

// POST /proxy-check: the safety check for a proxy not saved in a profile yet.
export interface CheckNewProxyRequest {
  /** Required unless `useTestProxy` is true. */
  proxy?: ProxySpec;
  useTestProxy?: boolean;
}
export type CheckNewProxyResponse = ProxyCheckResult;

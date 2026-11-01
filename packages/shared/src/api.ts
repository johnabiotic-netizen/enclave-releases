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
  'RELAY_UNREACHABLE',
  'RELAY_REFUSED',
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
  /**
   * With a new proxy in another country: move the profile there ("Update location"). Only the
   * location changes (time zone, language and its Windows voices, geolocation); the rest of
   * the fingerprint stays. Without it such a proxy is refused (PROXY_LOCATION_MISMATCH).
   */
  updateLocation?: boolean;
}
export type UpdateProfileResponse = Profile;

// POST /profiles/:id/update-location: the profile's own proxy now exits in another country
// (a start was refused with PROXY_LOCATION_MISMATCH); move the profile there.
export type UpdateLocationResponse = Profile;

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

// GET /profiles/:id/downloads: what the profile has downloaded (newest first), while it runs.
export interface DownloadedFile {
  name: string;
  bytes: number;
  /** When the download finished. */
  modifiedAt: string;
}
export type ListDownloadsResponse = DownloadedFile[];
/** GET /profiles/:id/downloads/:name gives the file (application/octet-stream), up to this size. */
export const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

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
  /** Memory each running profile uses now (null when Docker could not say). */
  profileMemory: { id: string; bytes: number | null }[];
}

// GET /system/image: the browser image download (POST /system/image starts it).
export interface ImageDownload {
  state: 'idle' | 'downloading' | 'done' | 'failed';
  /** Bytes downloaded and in all, over the layers Docker has announced so far. */
  downloadedBytes: number;
  totalBytes: number;
  /** Layers unpacked, of all. */
  layersDone: number;
  layers: number;
  error?: string;
}

// POST /proxy-check: the safety check for a proxy not saved in a profile yet.
export interface CheckNewProxyRequest {
  /** Required unless `useTestProxy` is true. */
  proxy?: ProxySpec;
  useTestProxy?: boolean;
}
export type CheckNewProxyResponse = ProxyCheckResult;

// ------------------------------------------------------------------ phone linking (Stage 6)

/** Which profiles a paired phone may see and open: all of them, or the ones listed (ids). */
export type PhoneProfiles = 'all' | string[];

/** A phone paired with this PC through the relay. */
export interface PairedPhone {
  id: string;
  name: string;
  pairedAt: string;
  profiles: PhoneProfiles;
  /** When the relay last saw it (null: never, or the relay could not be asked). */
  lastSeenAt: string | null;
}

// GET /relay
export interface RelayStatus {
  /** Phone access goes through the relay (the app's phone setting). */
  enabled: boolean;
  signedIn: boolean;
  /** The relay's address, e.g. https://relay.example.com. */
  url?: string;
  email?: string;
  pcName?: string;
  /** The PC's link to the relay is up (phones can reach it). */
  connected: boolean;
  /** Why it isn't, in words for the user. */
  problem?: string;
  devices: PairedPhone[];
}

// POST /relay/sign-in: sign in (or make the account first) and register this PC.
export interface RelaySignInRequest {
  url: string;
  email: string;
  password: string;
  /** This PC's name as the phone shows it. */
  pcName: string;
  createAccount?: boolean;
  inviteCode?: string;
}

// POST /relay/pairing: a QR code for pairing a phone, with the profiles it may open.
export interface RelayPairingRequest {
  profiles: PhoneProfiles;
}
export interface RelayPairingResponse {
  /** What the QR code holds: the relay's address with a one-time code and secret. */
  link: string;
  expiresAt: string;
}

// PATCH /relay/devices/:id: change which profiles a paired phone may open (at once, open
// streams of profiles taken away close).
export interface UpdatePairedPhoneRequest {
  profiles: PhoneProfiles;
}

// DELETE /relay/devices/:id: unpair a phone. POST /relay/sign-out: forget the relay.

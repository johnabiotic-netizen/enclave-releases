// Matches `fingerprint` in specs/profile-schema.md. Written once at creation (docs/05-fingerprints.md).

export interface ScreenInfo {
  width: number;
  height: number;
  availHeight?: number;
  colorDepth?: number;
  devicePixelRatio?: number;
}

export interface HardwareInfo {
  cores: number;
  memoryGb: number;
}

export interface WebGlInfo {
  vendor: string;
  renderer: string;
  [key: string]: unknown;
}

export interface Geolocation {
  lat: number;
  lon: number;
  accuracy: number;
}

export type MediaDeviceKind = 'videoinput' | 'audioinput' | 'audiooutput';

export interface MediaDeviceInfo {
  kind: MediaDeviceKind;
  label: string;
}

export const WEBRTC_POLICIES = ['proxy-only', 'disabled'] as const;
export type WebRtcPolicy = (typeof WEBRTC_POLICIES)[number];

export interface Fingerprint {
  os: 'windows';
  camoufoxVersion?: string;
  generatorVersion?: string;
  userAgent: string;
  screen: ScreenInfo;
  hardware?: HardwareInfo;
  webgl?: WebGlInfo;
  canvasSeed: string;
  audioSeed: string;
  fonts?: string[];
  locale: string;
  languages?: string[];
  timezone: string;
  geolocation?: Geolocation;
  mediaDevices?: MediaDeviceInfo[];
  webrtc?: WebRtcPolicy;
  /** Exact object Camoufox needs to reproduce this fingerprint. */
  raw?: Record<string, unknown>;
}

/** The only fingerprint fields that may change after creation, via "Update location". */
export const LOCATION_FIELDS = ['timezone', 'locale', 'languages', 'geolocation'] as const;
export type FingerprintLocation = Pick<Fingerprint, (typeof LOCATION_FIELDS)[number]>;

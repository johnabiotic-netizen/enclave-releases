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
  /** Firefox does not expose device memory, so Camoufox fingerprints usually omit it. */
  memoryGb?: number;
}

export interface WebGlInfo {
  vendor: string;
  renderer: string;
  [key: string]: unknown;
}

export interface Geolocation {
  lat: number;
  lon: number;
  accuracy?: number;
}

export type MediaDeviceKind = 'videoinput' | 'audioinput' | 'audiooutput';

export interface MediaDeviceInfo {
  kind: MediaDeviceKind;
  label: string;
}

export const WEBRTC_POLICIES = ['proxy-only', 'disabled'] as const;
export type WebRtcPolicy = (typeof WEBRTC_POLICIES)[number];

/** Output of the generator, saved once (images/browser/profile_build.py). */
export interface FingerprintRaw {
  /** Camoufox config, passed to the browser as CAMOU_CONFIG. */
  config: Record<string, unknown>;
  /** Firefox prefs that belong to the fingerprint, passed as CAMOU_PREFS. */
  prefs: Record<string, unknown>;
}

export interface Fingerprint {
  os: 'windows';
  camoufoxVersion?: string;
  generatorVersion?: string;
  userAgent: string;
  screen: ScreenInfo;
  hardware?: HardwareInfo;
  webgl?: WebGlInfo;
  /** Camoufox >= 156.0.1-beta.32 adds no canvas noise, so new fingerprints have no canvas seed. */
  canvasSeed?: string;
  audioSeed: string;
  fonts?: string[];
  locale: string;
  languages?: string[];
  timezone: string;
  geolocation?: Geolocation;
  mediaDevices?: MediaDeviceInfo[];
  webrtc?: WebRtcPolicy;
  /** What the browser actually uses; the fields above summarize it. Replayed on every launch. */
  raw?: FingerprintRaw;
}

/** The only fingerprint fields that may change after creation, via "Update location". */
export const LOCATION_FIELDS = ['timezone', 'locale', 'languages', 'geolocation'] as const;
export type FingerprintLocation = Pick<Fingerprint, (typeof LOCATION_FIELDS)[number]>;

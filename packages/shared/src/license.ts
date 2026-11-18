// License keys (specs/license.md). Pure types and parsing only: no crypto here, so the app's UI can import this.
// Signing is done by the owner's CLI (packages/relay) and verifying by the agent (packages/agent).

export const LICENSE_PREFIX = 'ENC1-';

/** What a key says. Signed as a whole, so none of it can be changed without the owner's private key. */
export interface LicensePayload {
  /** Format version. */
  v: 1;
  /** Random key id; the relay binds a PC to it and can revoke it. */
  id: string;
  /** Who the key was issued to. */
  name: string;
  /** ISO dates (YYYY-MM-DD). */
  issued: string;
  expires: string;
  /** How many PCs may use it. Always 1 for now. */
  pcs: number;
}

export interface ParsedLicenseKey {
  payload: LicensePayload;
  /** The exact bytes that were signed. */
  payloadBytes: Uint8Array;
  signature: Uint8Array;
}

export type LicenseProblem =
  'malformed' | 'bad-signature' | 'expired' | 'revoked' | 'other-pc' | 'unreachable';

export interface LicenseStatus {
  licensed: boolean;
  /** Present when licensed, and when a stored key is no longer valid (to say why). */
  name?: string;
  expires?: string;
  problem?: LicenseProblem;
  /** ISO time of the last good relay check. */
  lastCheck?: string;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Splits "ENC1-<payload>.<signature>" into its parts, checking the shape (not the signature). */
export function parseLicenseKey(key: string): ParsedLicenseKey | null {
  const text = key.trim().replace(/\s+/g, '');
  if (!text.startsWith(LICENSE_PREFIX)) return null;
  const [p, s, extra] = text.slice(LICENSE_PREFIX.length).split('.');
  if (!p || !s || extra !== undefined) return null;
  const payloadBytes = b64urlDecode(p);
  const signature = b64urlDecode(s);
  if (!payloadBytes || !signature || signature.length !== 64) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const o = raw as Partial<LicensePayload> | null;
  if (
    !o ||
    o.v !== 1 ||
    typeof o.id !== 'string' ||
    !/^[A-Za-z0-9_-]{8,40}$/.test(o.id) ||
    typeof o.name !== 'string' ||
    o.name.length < 1 ||
    o.name.length > 80 ||
    typeof o.issued !== 'string' ||
    typeof o.expires !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(o.issued) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(o.expires) ||
    typeof o.pcs !== 'number' ||
    !Number.isInteger(o.pcs) ||
    o.pcs < 1
  )
    return null;
  return { payload: o as LicensePayload, payloadBytes, signature };
}

export function formatLicenseKey(payloadBytes: Uint8Array, signature: Uint8Array): string {
  return `${LICENSE_PREFIX}${b64urlEncode(payloadBytes)}.${b64urlEncode(signature)}`;
}

/** A key is valid through the end of its expiry day (UTC). */
export function licenseExpired(payload: LicensePayload, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(`${payload.expires}T00:00:00Z`) + 24 * 3600 * 1000;
}

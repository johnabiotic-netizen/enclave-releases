// License verification (specs/license.md): is this key signed by the owner, for this PC, and not expired?
import { createPublicKey, verify } from 'node:crypto';
import {
  licenseExpired,
  parseLicenseKey,
  type LicensePayload,
  type LicenseProblem,
} from '@enclave/shared';

/**
 * The owner's public key (Ed25519, raw 32 bytes as base64url). It can only check keys, never make
 * them. Paste the value `license keygen` prints. Empty until the owner has made a key pair.
 */
export const LICENSE_PUBLIC_KEY = 'p_k1gxrDrclIQQD0IOr8Opx7XFaETrKz4ef1imRPeAM';

// The fixed prefix of a DER SubjectPublicKeyInfo for an Ed25519 key; the 32 raw bytes follow.
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export type VerifyResult =
  { ok: true; payload: LicensePayload } | { ok: false; problem: LicenseProblem };

export function verifyLicenseKey(
  key: string,
  publicKeyB64: string = LICENSE_PUBLIC_KEY,
  now: Date = new Date(),
): VerifyResult {
  const parsed = parseLicenseKey(key);
  if (!parsed) return { ok: false, problem: 'malformed' };
  const raw = Buffer.from(publicKeyB64, 'base64url');
  if (raw.length !== 32) return { ok: false, problem: 'bad-signature' };
  let good: boolean;
  try {
    const pub = createPublicKey({
      key: Buffer.concat([SPKI_ED25519, raw]),
      format: 'der',
      type: 'spki',
    });
    good = verify(null, parsed.payloadBytes, pub, parsed.signature);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, problem: 'bad-signature' };
  if (licenseExpired(parsed.payload, now)) return { ok: false, problem: 'expired' };
  return { ok: true, payload: parsed.payload };
}

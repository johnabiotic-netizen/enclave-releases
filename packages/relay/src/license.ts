// The relay's side of license keys (specs/license.md): check a key, bind it to one PC, honour revocation.
import { createPublicKey, verify } from 'node:crypto';
import {
  LICENSE_PUBLIC_KEY,
  licenseExpired,
  parseLicenseKey,
  type LicenseCheckResponse,
  type LicensePayload,
} from '@enclave/shared';
import type { RelayStore } from './store.js';

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** The payload if the key is signed by the owner, otherwise null. */
export function signedPayload(
  key: string,
  publicKeyB64 = LICENSE_PUBLIC_KEY,
): LicensePayload | null {
  const parsed = parseLicenseKey(key);
  const raw = Buffer.from(publicKeyB64, 'base64url');
  if (!parsed || raw.length !== 32) return null;
  try {
    const pub = createPublicKey({
      key: Buffer.concat([SPKI_ED25519, raw]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, parsed.payloadBytes, pub, parsed.signature) ? parsed.payload : null;
  } catch {
    return null;
  }
}

export async function checkLicense(
  store: RelayStore,
  key: string,
  pc: string,
  now = new Date(),
  publicKeyB64 = LICENSE_PUBLIC_KEY,
): Promise<LicenseCheckResponse> {
  const payload = signedPayload(key, publicKeyB64);
  if (!payload) return { status: 'invalid' };
  const info = { name: payload.name, expires: payload.expires };
  const rec = store.license(payload.id);
  if (rec?.revoked) return { status: 'revoked', ...info };
  if (licenseExpired(payload, now)) return { status: 'expired', ...info };
  if (rec?.pcHash && rec.pcHash !== pc) return { status: 'other-pc', ...info };
  await store.recordLicenseCheck(payload, pc, now);
  return { status: 'ok', ...info };
}

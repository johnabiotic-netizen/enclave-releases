// TURN credentials in coturn's "REST API" form (use-auth-secret): the user name is
// "<expiry, unix seconds>:<who>", the password HMAC-SHA1 of it with the shared secret. coturn
// checks both without asking the relay, and a password stops working when its time is up.

import { createHmac } from 'node:crypto';
import type { IceServer, PcTurn } from '@enclave/shared';
import type { RelayConfig } from './config.js';

/** A phone's credentials last one connection, with room for a long session. */
export const PHONE_TURN_TTL_S = 12 * 60 * 60;
/** The PC's are given to each profile at start, and a profile can run for days. */
export const PC_TURN_TTL_S = 30 * 24 * 60 * 60;

export function turnCredential(secret: string, who: string, ttlSeconds: number, now = Date.now()) {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expires}:${who}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt: new Date(expires * 1000).toISOString() };
}

export function phoneIceServers(turn: RelayConfig['turn'], deviceId: string): IceServer[] {
  if (!turn) return [];
  const { username, credential } = turnCredential(turn.secret, deviceId, PHONE_TURN_TTL_S);
  const urls = [
    `turn:${turn.host}:${turn.port}?transport=udp`,
    `turn:${turn.host}:${turn.port}?transport=tcp`,
    ...(turn.tlsPort ? [`turns:${turn.host}:${turn.tlsPort}?transport=tcp`] : []),
  ];
  return [{ urls: [`stun:${turn.host}:${turn.port}`] }, { urls, username, credential }];
}

export function pcTurn(turn: RelayConfig['turn'], pcId: string): PcTurn | null {
  if (!turn) return null;
  return { ip: turn.ip, port: turn.port, ...turnCredential(turn.secret, pcId, PC_TURN_TTL_S) };
}

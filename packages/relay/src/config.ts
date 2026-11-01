// The relay's settings, from the environment (docs/setup/relay-deploy.md lists them).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RelayConfig {
  /** Where the relay listens. Behind Caddy in the container: 0.0.0.0:8790, not published. */
  host: string;
  port: number;
  /** Where accounts, PCs and phones are kept (one JSON file). */
  dataDir: string;
  /** The built phone app (packages/mobile/dist), served from `/`. */
  staticDir: string;
  /** Who may make an account. */
  signup: 'open' | 'invite' | 'closed';
  inviteCode: string | undefined;
  /** Caddy in front: take the client's address from X-Forwarded-For. */
  trustProxy: boolean;
  turn:
    | {
        /** coturn's static-auth-secret: TURN passwords are made from it, never stored. */
        secret: string;
        /** The name phones reach TURN at (the relay's domain). */
        host: string;
        /** The server's public IPv4, for the PC's streaming program (it has no DNS). */
        ip: string;
        port: number;
        /** TURN over TLS, for phones on networks that block everything else. */
        tlsPort: number | undefined;
      }
    | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const signup = env.RELAY_SIGNUP ?? 'invite';
  if (signup !== 'open' && signup !== 'invite' && signup !== 'closed') {
    throw new Error(`RELAY_SIGNUP must be open, invite or closed, got "${signup}".`);
  }
  const inviteCode = env.RELAY_INVITE_CODE || undefined;
  // With RELAY_SIGNUP=invite, accounts need RELAY_INVITE_CODE (if set) or a single-use
  // invite (node relay.mjs invite <note>).
  if (inviteCode && inviteCode.length < 12) {
    throw new Error('RELAY_INVITE_CODE must be at least 12 characters.');
  }
  const secret = env.TURN_SECRET;
  if (secret && secret.length < 32) throw new Error('TURN_SECRET must be at least 32 characters.');
  if (secret && (!env.TURN_HOST || !env.TURN_IP)) {
    throw new Error('TURN_SECRET needs TURN_HOST (the domain) and TURN_IP (public IPv4).');
  }
  if (env.TURN_IP && !/^\d{1,3}(\.\d{1,3}){3}$/.test(env.TURN_IP)) {
    throw new Error(`TURN_IP must be an IPv4 address, got "${env.TURN_IP}".`);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    host: env.RELAY_HOST || '127.0.0.1',
    port: env.RELAY_PORT ? port(env.RELAY_PORT, 'RELAY_PORT') : 8790,
    dataDir: env.RELAY_DATA || path.resolve(here, '../data'),
    staticDir: env.RELAY_STATIC_DIR || path.resolve(here, '../../mobile/dist'),
    signup,
    inviteCode,
    trustProxy: env.RELAY_TRUST_PROXY === '1',
    turn: secret
      ? {
          secret,
          host: env.TURN_HOST!,
          ip: env.TURN_IP!,
          port: env.TURN_PORT ? port(env.TURN_PORT, 'TURN_PORT') : 3478,
          tlsPort: env.TURN_TLS_PORT ? port(env.TURN_TLS_PORT, 'TURN_TLS_PORT') : undefined,
        }
      : undefined,
  };
}

function port(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number.`);
  return n;
}

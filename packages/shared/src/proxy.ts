// Matches `proxy` in specs/profile-schema.md and specs/schemas/profile.schema.json.

export const PROXY_TYPES = ['socks5', 'http', 'https'] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

/** Result of the proxy safety check (docs/06-proxies.md). Stored as `proxy.lastCheck`. */
export interface ProxyCheckResult {
  at: string;
  ok: boolean;
  exitIp?: string;
  country?: string;
  city?: string;
  timezone?: string;
  latencyMs?: number;
}

/** Proxy as stored in profile.json. The password is never stored here, only `secretRef`. */
export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  /** Reference to the password in the secret store, e.g. `keyring:profile-<id>-proxy`. */
  secretRef?: string;
  lastCheck?: ProxyCheckResult;
}

/** Structured proxy sent by a client. Carries the password, so it never goes to disk as is. */
export interface ProxyInput {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * What clients may send for a proxy: either a structured object or a raw string in one of the
 * three accepted formats (socks5://user:pass@host:port, http://user:pass@host:port,
 * host:port:user:pass). The agent parses and validates it.
 */
export type ProxySpec = ProxyInput | string;

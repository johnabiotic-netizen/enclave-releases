// The relay (Stage 6, specs/relay-protocol.md): pairs phones with PCs and carries an
// end-to-end encrypted tunnel between them. The relay sees who talks to whom and how much,
// never what: everything inside the tunnel is encrypted with keys only the PC and the phone
// hold (tunnel.ts).

/** Where the relay's own API lives on its host; the phone app is served from `/`. */
export const RELAY_API_PATH = '/r/v1';

/** A pairing code (and the QR code that carries it) works for this long. */
export const PAIRING_TTL_MS = 2 * 60 * 1000;

// ------------------------------------------------------------------ relay HTTP API

// GET /r/v1/info
export interface RelayInfo {
  name: 'enclave-relay';
  version: string;
  /** Whether a new account needs an invite code ('invite') or can't be made at all ('closed'). */
  signup: 'open' | 'invite' | 'closed';
}

// POST /r/v1/accounts
export interface CreateAccountRequest {
  email: string;
  password: string;
  inviteCode?: string;
}

// POST /r/v1/pcs: sign in with the account and register this PC (one call, so the PC never
// keeps the password or an account session).
export interface RegisterPcRequest {
  email: string;
  password: string;
  /** The PC's name as the phone shows it. */
  name: string;
  /** The PC's tunnel key (ECDH P-256, raw public key, base64url). */
  publicKey: string;
}
export interface RegisterPcResponse {
  pcId: string;
  /** The PC's credential for the relay; kept sealed on the PC. */
  pcSecret: string;
}

// POST /r/v1/pairings (as the PC): a one-time code for the QR.
export interface CreatePairingResponse {
  code: string;
  expiresAt: string;
}

// POST /r/v1/pairings/claim (as the phone, no account): the phone's half of the QR.
export interface ClaimPairingRequest {
  code: string;
  /** The phone's name as the PC lists it. */
  deviceName: string;
  /** The phone's tunnel key (ECDH P-256, raw public key, base64url). */
  publicKey: string;
  /** HMAC with the QR's secret over both keys (tunnel.ts pairingProof): the relay can't make one. */
  proof: string;
}
export interface ClaimPairingResponse {
  deviceId: string;
  /** The phone's credential for the relay; kept on the phone. */
  deviceKey: string;
  pc: { id: string; name: string; publicKey: string };
}

// GET /r/v1/devices (as the PC)
export interface RelayDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

// DELETE /r/v1/devices/:id (as the PC): revoke. DELETE /r/v1/pcs/self (as the PC): sign out.

/** An ICE server as WebRTC takes it. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** What the PC's streaming program uses to reach the TURN server (by IP: it has no DNS). */
export interface PcTurn {
  ip: string;
  port: number;
  username: string;
  credential: string;
  expiresAt: string;
}

// ------------------------------------------------------------------ WebSocket messages

// WS /r/v1/ws/pc and /r/v1/ws/phone. Control messages are JSON text frames; tunnel data are
// binary frames: [1][session id, 16 bytes][payload].
export const TUNNEL_FRAME = 1;
export const SESSION_ID_BYTES = 16;

export type PcToRelay =
  | { type: 'REGISTER'; pcId: string; pcSecret: string; version: string }
  | { type: 'PAIRING_RESULT'; pairingId: string; ok: boolean }
  | { type: 'SESSION_CLOSE'; sessionId: string; reason: string };

export type RelayToPc =
  | { type: 'REGISTERED'; turn: PcTurn | null }
  | {
      type: 'PAIRING_REQUEST';
      pairingId: string;
      code: string;
      deviceId: string;
      deviceName: string;
      publicKey: string;
      proof: string;
    }
  | { type: 'SESSION_REQUEST'; sessionId: string; deviceId: string }
  | { type: 'SESSION_CLOSED'; sessionId: string; reason: string }
  | { type: 'REVOKED'; deviceId: string }
  | { type: 'ERROR'; message: string };

export type PhoneToRelay =
  | { type: 'HELLO'; deviceId: string; deviceKey: string; version: string }
  | { type: 'OPEN_SESSION' }
  | { type: 'SESSION_CLOSE'; sessionId: string; reason: string };

export type RelayToPhone =
  | { type: 'WELCOME'; pc: { id: string; name: string; online: boolean } }
  | { type: 'PC_ONLINE'; online: boolean }
  | { type: 'SESSION_GRANTED'; sessionId: string; iceServers: IceServer[] }
  | { type: 'SESSION_DENIED'; reason: string }
  | { type: 'SESSION_CLOSED'; sessionId: string; reason: string }
  | { type: 'REVOKED' }
  | { type: 'ERROR'; message: string };

/** WebSocket close codes the relay uses (4000 to 4999 are free for applications). */
export const RELAY_CLOSE = {
  /** Wrong or missing credentials. */
  UNAUTHORIZED: 4401,
  /** The phone was unpaired (revoked) on the PC. */
  REVOKED: 4403,
  /** The same PC connected again elsewhere. */
  REPLACED: 4409,
  /** This version of Enclave is older than the relay accepts (RELAY_MIN_AGENT_VERSION). */
  UPDATE: 4426,
} as const;

# Relay protocol (Stage 6)

The relay pairs phones with PCs and passes an end-to-end encrypted tunnel between them. It never carries browsing data it can read and never sees media (media is direct or TURN relayed, always DTLS-SRTP). Types: `packages/shared/src/relay.ts` (messages) and `packages/shared/src/tunnel.ts` (the tunnel).

## Entities
- **Account:** email and password (argon2id: 19 MiB, 2 passes). Owns PCs. Who may make one: `RELAY_SIGNUP` = `invite` (with `RELAY_INVITE_CODE`), `open` or `closed`.
- **PC (agent):** registered by signing in once with the account's email and password (the PC keeps neither); gets a PC id and secret, and keeps one outbound WebSocket to the relay. Holds a long-lived tunnel key (ECDH P-256).
- **Device (phone):** one phone paired with one PC, with a device key for the relay and its own tunnel key (ECDH P-256, private half non-extractable, in the phone's IndexedDB). A phone paired with two PCs is two devices.

The relay stores accounts, PCs (id, name, hashed secret, public tunnel key) and devices (id, PC, name, hashed key, last seen) in one JSON file. Not stored or seen: profile names, cookies, pages, media, proxy details, the agent's API traffic, WebRTC signaling.

## Pairing
1. The Windows app asks its agent for a pairing (`POST /v1/relay/pairing`). The agent gets a one-time code from the relay (`POST /r/v1/pairings`, 2 minutes) and adds a random secret and a hash of its tunnel key, which never go to the relay. The QR code holds `https://<relay>/#pair=<code>.<secret>.<PC key hash>`.
2. The phone's camera opens that link; the relay serves the phone app. The phone makes its tunnel key and sends `POST /r/v1/pairings/claim { code, deviceName, publicKey, proof }`, where `proof` is HMAC-SHA256 with the QR secret over its key and the PC key hash.
3. The relay takes the code (once), saves a device, and asks the PC over its socket (`PAIRING_REQUEST`). The PC checks the proof with its secret: a phone key swapped by the relay fails. It keeps the phone's key and answers `PAIRING_RESULT { ok }`. On no (or no answer in 15 s) the relay deletes the device.
4. The relay returns `{ deviceId, deviceKey, pc: { id, name, publicKey } }`. The phone checks the PC key against the hash from the QR code: a PC key swapped by the relay fails. It keeps its identity.
5. The PC's own list of paired phones (with their keys) is what counts. A device the relay knows but the PC doesn't can't open a session.

## Connecting
1. The phone opens `wss://<relay>/r/v1/ws/phone`, sends `HELLO { deviceId, deviceKey }`, gets `WELCOME { pc: { id, name, online } }`.
2. `OPEN_SESSION`: the relay makes a random session id, tells the PC `SESSION_REQUEST { sessionId, deviceId }` and the phone `SESSION_GRANTED { sessionId, iceServers }` (its own TURN credentials, 12 hours).
3. Tunnel frames go as binary WebSocket messages, `[1][session id, 16 bytes][payload]`, which the relay passes to the session's other side without reading.
4. The tunnel handshake (`tunnel.ts`): each side sends a fresh ECDH key and a nonce; keys are HKDF-SHA256 over ECDH(ephemeral, ephemeral) and ECDH(static, static), salted by both nonces and bound to all four keys; AES-256-GCM per direction with a counter nonce (no replay, no reordering, no dropping unnoticed). Only the paired static keys give the right keys, so the first message that decrypts proves both ends.
5. Inside the tunnel the phone opens channels: requests (`REQUEST`, `DATA` pieces of up to 256 KB with at most 8 unacknowledged, `END`; answered by `RESPONSE`) and WebSockets (`WS_OPEN`, `WS_TEXT`, `WS_CLOSE`). The PC answers only the phone app's calls (`GET /v1/profiles`, `POST /v1/profiles/:id/start|stop`, `GET /v1/profiles/:id/stream|media`, `POST /v1/profiles/:id/files`) and running profiles' stream servers (`/neko/<profile id>/api/...`). Each profile's per-start stream password still applies. Each paired phone may open all profiles or only the ones chosen for it (set when pairing, changed in Settings); the PC filters the list and refuses the rest, and closes open streams of a profile taken away. The relay knows nothing of it.
6. A session ends when either side closes it, either socket drops, or the phone is revoked. A dropped phone reconnects with a new session.

## Messages (WebSocket, JSON text frames)
```
pc -> relay:    REGISTER { pcId, pcSecret, version } ; PAIRING_RESULT { pairingId, ok } ; SESSION_CLOSE { sessionId, reason }
relay -> pc:    REGISTERED { turn } ; PAIRING_REQUEST { pairingId, code, deviceId, deviceName, publicKey, proof }
                SESSION_REQUEST { sessionId, deviceId } ; SESSION_CLOSED { sessionId, reason } ; REVOKED { deviceId } ; ERROR { message }
phone -> relay: HELLO { deviceId, deviceKey, version } ; OPEN_SESSION ; SESSION_CLOSE { sessionId, reason }
relay -> phone: WELCOME { pc } ; PC_ONLINE { online } ; SESSION_GRANTED { sessionId, iceServers } ; SESSION_DENIED { reason }
                SESSION_CLOSED { sessionId, reason } ; REVOKED ; ERROR { message }
```
Close codes: 4401 unknown credentials, 4403 revoked, 4409 the same PC connected elsewhere. Sockets are pinged every 25 s; a socket must say who it is within 10 s. A browser may open a socket only from the relay's own page (Origin must match Host).

## HTTP (`/r/v1`)
`GET /info` (`{ name, version, signup }`), `POST /accounts`, `POST /pcs` (sign in and register), `DELETE /pcs/self` (sign out, unpairs every phone), `POST /pairings`, `POST /pairings/claim`, `GET /devices`, `DELETE /devices/:id` (revoke). PC calls use `Authorization: Bearer <pc id>.<pc secret>`. Password checks: 10 per 10 minutes per address; claims: 20.

## Media
- neko (the profile's streaming program) runs without ICE lite in relay mode, with the relay's STUN and TURN servers by IP (the container has no DNS). Its credentials (coturn `use-auth-secret`, 30 days) come with `REGISTERED`; a running profile keeps the ones it started with.
- The egress lock lets neko's own group (`stream`) send UDP anywhere and reach the TURN server over TCP; the browser still reaches only its proxy (`images/browser/apply_egress_lock.sh`). So media goes direct where the networks allow it, and through TURN (UDP, or TCP 3478 where UDP is blocked) otherwise.
- The phone app replaces whatever ICE servers neko offers with its own from `SESSION_GRANTED`.

## Security
- All connections over TLS/WSS (Caddy in front of the relay).
- Session ids are per connection; the tunnel's keys are per session.
- Revoking a phone removes its key on the PC first, then on the relay, which drops its sockets and sessions at once.
- The relay could deny service or lie about who is online, but can't read, change or start a session: it holds no tunnel key and can't forge a pairing.

## Differences from the first plan (DECISIONS.md 2026-11-01)
- The phone is not logged in to the account: the QR code (one-time code plus a secret the relay never sees) is what pairs it.
- Sessions are per phone and PC, not per profile; the profile list and everything else travel inside the encrypted tunnel, so the relay doesn't see them at all (the first plan had the relay forward a profiles snapshot).
- No TURN over TLS yet: TURN over TCP 3478 covers networks that block UDP.

## Deployment
`docs/setup/relay-deploy.md`: one small server with the relay, Caddy and coturn in Docker (`deploy/relay/`). Never run browser containers on the relay host.

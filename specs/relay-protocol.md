# Relay protocol (Stage 6)

The relay pairs phones with PCs and tunnels WebRTC signaling. It never carries browsing data and never sees media content (media is P2P or TURN relayed, always DTLS-SRTP).

## Entities
- **Account:** email + password (hashed, argon2). Owns PCs and phones.
- **PC (agent):** registers with the account, keeps one outbound WebSocket to the relay.
- **Phone (device):** paired to the account, holds a long lived device key.

## Pairing
1. Desktop app asks relay for a pairing code (short lived, e.g. 2 minutes). Shows it as a QR.
2. Phone (logged into the account) scans the QR, sends the code to the relay.
3. Relay validates, binds the phone to the account, issues the phone a device key.
4. Desktop app shows the new device in its device list.

## Connecting to a profile
1. Phone asks relay for the list of the account's online PCs and their profiles (proxied through the agent's outbound socket; the relay forwards, does not store).
2. Phone requests a session for `pcId + profileId`.
3. Relay issues a short lived session token and introduces the two peers.
4. WebRTC signaling (SDP, ICE) is tunneled through the relay. Media connects P2P via STUN, or via coturn TURN if needed.
5. On disconnect or revoke, the session token dies.

## Messages (WebSocket, JSON)
```
pc -> relay:    REGISTER { accountToken } ; HEARTBEAT ; PROFILES_SNAPSHOT {...} ; SIGNAL {sessionId, sdp|ice}
phone -> relay: LIST_PCS ; REQUEST_SESSION {pcId, profileId} ; SIGNAL {sessionId, sdp|ice}
relay -> pc:    SESSION_REQUEST {sessionId, deviceId, profileId} ; SIGNAL {...} ; REVOKED {deviceId}
relay -> phone: PCS {...} ; SESSION_GRANTED {sessionId, iceServers} ; SIGNAL {...} ; SESSION_DENIED {reason}
```

## Security
- All connections over TLS/WSS.
- Session tokens short lived, scoped to one profile.
- Revoking a phone invalidates its device key immediately; active sessions dropped.
- Relay stores: accounts, device records, pairing codes. Not stored: cookies, page content, media, proxy credentials.
- Per profile stream password still applies as a second factor.

## Deployment notes
- Relay: Railway or Fly.io is fine (it is light and stateless apart from a small DB).
- coturn: a small VPS with a public IP; set realm, static auth secret, TLS.
- Do NOT run browser containers on the relay host.

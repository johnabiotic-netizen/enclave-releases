# Stage 6: Phone linking without Tailscale

**Goal:** pair a phone to the PC by scanning a QR code, and connect through your own relay with TURN fallback, so phone access works on any network without Tailscale.

**Done when** a phone on mobile data, with the PC on home wifi, can open and use a profile securely.

## Verify first
- coturn current setup; STUN/TURN config and credentials model.
- Hosting choice for the relay (Railway, Fly.io, VPS). Note that Railway is fine for the relay but not for running browsers.

## Build tasks
- [ ] `packages/relay`: Node + Fastify + ws. Responsibilities: account login, device registry, pairing, and signaling tunnel between phone and agent. Stores no browsing data. See `specs/relay-protocol.md`.
- [ ] Agent: keep a persistent outbound connection to the relay (so no inbound ports on the PC). Register availability, receive connect requests, start WebRTC signaling.
- [ ] Pairing: PC app shows a QR with a one time code; phone scans; relay binds the device to the account; store a long lived device key on the phone.
- [ ] Session tokens: short lived, per connection, per profile.
- [ ] Media path: direct P2P when possible (STUN), TURN relay fallback (coturn). All media DTLS-SRTP.
- [ ] Device management UI in the desktop app: list paired phones, revoke a device.
- [ ] Deploy the relay; write `docs/setup/relay-deploy.md`.

## Acceptance tests
1. **Pairing:** scan the QR once; the phone is linked and remembers it.
2. **Cross network:** phone on cellular, PC on wifi; open a profile and use it.
3. **TURN fallback:** simulate a restrictive network; media still connects via TURN.
4. **Security:** a device that is not paired cannot connect; revoking a phone cuts its access immediately.
5. **No browsing data on the relay:** verify by inspection that only pairing and account data pass through.

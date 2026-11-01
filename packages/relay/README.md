# @enclave/relay

The Enclave relay (Stage 6): pairs phones with PCs and passes the end-to-end encrypted tunnel between them, and serves the phone app. It keeps accounts, PCs and paired phones in one JSON file and never sees browsing data. Protocol: `specs/relay-protocol.md`. Deploying: `docs/setup/relay-deploy.md`.

- `src/server.ts`: HTTP API (`/r/v1`), WebSockets, the phone app's files.
- `src/hub.ts`: connected PCs and phones, sessions, pairing answers, revoking.
- `src/store.ts`: the JSON file; argon2id passwords (Node's built-in), hashed PC and device secrets.
- `src/turn.ts`: coturn time-limited credentials.

Run locally (after `pnpm build` and `node packages/mobile/build.mjs`):

```bash
RELAY_SIGNUP=open RELAY_PORT=8790 node packages/relay/dist/main.js
```

Settings (environment): `RELAY_HOST` (default 127.0.0.1), `RELAY_PORT` (8790), `RELAY_DATA`, `RELAY_STATIC_DIR`, `RELAY_SIGNUP` (`invite` default, `open`, `closed`), `RELAY_INVITE_CODE`, `RELAY_TRUST_PROXY=1` behind Caddy, and for TURN `TURN_SECRET`, `TURN_HOST`, `TURN_IP`, `TURN_PORT`, `TURN_TLS_PORT`.

The container image bundles it with esbuild (`build.mjs`) and the phone app: `packages/relay/Dockerfile`. Tests: `pnpm exec vitest run packages/relay`.

# License keys

The app only opens for someone the owner has issued a key to. Design decided 2026-11-18 (DECISIONS.md).

## The key
A text token the owner sends to a user: `ENC1-<payload>.<signature>`.
- **Payload** (JSON, base64url): `id` (random key id), `name` (who it is for), `issued`, `expires` (ISO dates), `pcs` (always 1 for now), `v` (format version 1).
- **Signature**: Ed25519 over the payload bytes, made with the owner's private key. The app holds only the public key, so it can check a key but nobody can make one.
- The private key lives only on the owner's PC (never in the repo, never on the relay). Hard rule 5 applies.

## Locked to one PC, and the daily check
One endpoint: `POST /r/v1/license/check` with `{ key, pc }`, where `pc` is a SHA-256 hash of the Windows machine GUID with an Enclave-specific salt (the GUID itself is never sent). The relay verifies the key's signature with the same public key, then answers `{ status, name, expires }` with status `ok | invalid | expired | revoked | other-pc`. The first good check from a PC binds the key id to that PC; a different PC with the same key gets `other-pc`. A user changing PC asks the owner to run `reset-pc`. The relay keeps one record per key id (PC hash, revoked, first and last check) in its data file. The route is rate limited (60 per 10 minutes per address).

The app checks once a day while it is open, and sends nothing else: no profiles, no browsing data, no IPs (hard rules and the no-telemetry rule; the owner approved this check 2026-11-18). The app stores the key sealed with Windows' credential store (safeStorage).
- `revoked` locks the app at the next check.
- **Offline grace:** if the relay can't be reached, the app keeps working for 14 days since the last good check, then shows "Connect to the internet to check your license".
- Running profiles are never stopped by a lock. The gate applies to opening the app and starting profiles.

## What the user sees
No valid key: one screen with a key box, "Activate", and the reason when a key is refused (wrong key, expired, revoked, used on another PC, couldn't reach the server). Copy follows `ui/copy-guidelines.md`. Settings shows who it is licensed to, the expiry date and the last check.

## Owner's tools
- On the owner's PC (`node packages/relay/dist/license-cli.js`): `keygen` (once), `issue --name <who> --days <n>` (prints the key), `list`, `revoke <id>` (marks it in the local list).
- On the relay server (inside its container, like invites): `node /app/relay.mjs licenses | license-revoke <id> | license-unrevoke <id> | license-reset-pc <id>`. Revoking an id that was never used creates its record, so the key is dead on first use.

## Rollout
Ship the feature in the next release with enforcement on. Before releasing, the owner issues every current tester a key and sends it with the update note, so nobody is locked out.

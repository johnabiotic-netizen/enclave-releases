# License keys

The app only opens for someone the owner has issued a key to. Design decided 2026-11-18 (DECISIONS.md).

## The key
A text token the owner sends to a user: `ENC1-<payload>.<signature>`.
- **Payload** (JSON, base64url): `id` (random key id), `name` (who it is for), `issued`, `expires` (ISO dates), `pcs` (always 1 for now), `v` (format version 1).
- **Signature**: Ed25519 over the payload bytes, made with the owner's private key. The app holds only the public key, so it can check a key but nobody can make one.
- The private key lives only on the owner's PC (never in the repo, never on the relay). Hard rule 5 applies.

## Locked to one PC
On first activation the app reads a PC fingerprint (a hash of the Windows machine GUID with an Enclave-specific salt; the GUID itself is never sent) and asks the relay to bind the key id to it. The relay answers with a signed **activation receipt** (key id, PC hash, bound date). The app stores key plus receipt, sealed with Windows' credential store (safeStorage). A different PC with the same key is refused by the relay, so a shared key stops working. A user changing PC asks the owner to reset the binding.

## Online check
Once a day, while the app is open, the agent sends the relay `{ key id, PC hash, app version }` over TLS and gets back `{ status: ok | revoked | expired, nextCheckBy }`. Nothing else is sent: no profiles, no browsing data, no IPs (hard rules and the no-telemetry rule; owner approved this check 2026-11-18).
- `revoked` locks the app at the next check.
- **Offline grace:** if the relay can't be reached, the app keeps working for 14 days since the last good check, then shows "Connect to the internet to check your license".
- Running profiles are never stopped by a lock. The gate applies to opening the app and starting profiles.

## What the user sees
No valid key: one screen with a key box, "Activate", and the reason when a key is refused (wrong key, expired, revoked, used on another PC, couldn't reach the server). Copy follows `ui/copy-guidelines.md`. Settings shows who it is licensed to, the expiry date and the last check.

## Owner's tools (a CLI in `packages/relay`, run on the owner's PC)
`license issue --name <who> --days <n>` (prints the key), `license list`, `license revoke <id>`, `license reset-pc <id>`, `license keygen` (once: makes the key pair).

## Rollout
Ship the feature in the next release with enforcement on. Before releasing, the owner issues every current tester a key and sends it with the update note, so nobody is locked out.

# Test plan

Testing is per stage. The authority on what "done" means is each stage spec's acceptance tests. This file adds the standing checks that apply across stages.

## Automated
- `packages/shared`: type tests compile.
- `packages/agent`: Vitest unit tests for proxy parsing (all three formats), the safety check logic (mock the network), fingerprint validation against the JSON schema, and idle stop timing.
- `packages/desktop` (Stage 5): Playwright smoke tests for create, start, view, stop, delete.
- `packages/relay` (Stage 6): unit tests for pairing, session issuance, and revoke.

## Manual, every time the browser image changes
- Run `testing/fingerprint-checklist.md` on three profiles.
- Confirm fail closed still holds (break proxy, no leak).

## Security regression (run before any release)
- Agent not reachable on 0.0.0.0.
- No secrets in logs or `profile.json`.
- WebRTC shows no real IP.
- Containers run as non root with dropped capabilities.

## Continuity (the core promise)
- PC to phone: half typed form survives, logins survive, no verification prompt from the switch.

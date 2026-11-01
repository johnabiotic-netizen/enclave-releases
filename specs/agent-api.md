# Agent API

Local HTTP API. Binds `127.0.0.1` only (Stage 2 may also bind the Tailscale interface). All requests require `Authorization: Bearer <AGENT_TOKEN>`. JSON in, JSON out. Types live in `packages/shared`.

Base: `http://127.0.0.1:<port>/v1`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | - | `{ ok, version, dockerOk }` |
| GET | `/profiles` | - | `Profile[]` (without secrets) |
| POST | `/profiles` | `{ name, proxy, template?, useTestProxy? }` | `Profile` (runs safety check, generates fingerprint) |
| GET | `/profiles/:id` | - | `Profile` |
| PATCH | `/profiles/:id` | `{ name?, notes?, idleStopMinutes?, proxy?, updateLocation? }` | `Profile`. A new proxy in another country is refused (`PROXY_LOCATION_MISMATCH`) unless `updateLocation: true` ("Update location": time zone, language and geolocation follow the proxy, the rest of the fingerprint stays) |
| POST | `/profiles/:id/update-location` | - | `Profile`: "Update location" after a start was refused because the profile's own proxy now exits in another country; stopped profiles only |
| DELETE | `/profiles/:id?confirm=true` | - | `{ ok }` (stops container, removes data; refused without `confirm=true`) |
| POST | `/profiles/:id/start` | - | `{ stream }` after health passes; errors if safety check fails |
| POST | `/profiles/:id/stop` | - | `{ ok }` |
| GET | `/profiles/:id/stream` | - | `{ url, phoneUrl?, password, expiresAt }` for the viewer (`phoneUrl` in phone mode, Stage 2) |
| GET | `/profiles/:id/media` | - | `{ camera, microphone, filePicker, phoneCamera, phoneMicrophone }`: whether a page in the running profile is using its camera or microphone now, whether it has a file picker open, and whether a phone is sharing its camera or microphone into it (Stage 4; the phone app offers to share them or a file; the Windows app asks the user to switch to the phone when nothing is shared) |
| POST | `/profiles/:id/files?name=<file name>` | the file, `application/octet-stream`, up to 100 MB | `{ ok }`: removes where a photo or video was taken (GPS, location), puts the file in the profile and picks it in the open file picker (Stage 4); `FILE_PICKER_CLOSED` if none is open |
| POST | `/profiles/:id/check-proxy` | - | `ProxyCheckResult` |
| GET | `/profiles/:id/logs` | `?tail=200` | `{ lines: string[] }` (never includes secrets) |
| GET | `/system` | - | `{ ram: { totalBytes, freeBytes }, profilesRunning, dockerOk, virtualizationOk, imageBuilt, testProxyAvailable, profileMemory: [{ id, bytes }] }` (memory each running profile uses now) |
| POST | `/proxy-check` | `{ proxy?, useTestProxy? }` | `ProxyCheckResult`: the safety check for a proxy not in a profile yet (the create wizard's Check); same errors as a start, saves nothing |
| GET | `/relay` | - | `RelayStatus`: `{ enabled, signedIn, url?, email?, pcName?, connected, problem?, devices: PairedPhone[] }` (Stage 6; `devices` is this PC's own list, last seen from the relay) |
| POST | `/relay/sign-in` | `{ url, email, password, pcName, createAccount?, inviteCode? }` | `RelayStatus`: registers this PC with the relay (makes the account first with `createAccount`); the password is not kept. A new sign-in replaces the old one and its paired phones |
| POST | `/relay/sign-out` | - | `{ ok }`: removes this PC from the relay and forgets its keys; every paired phone loses access |
| POST | `/relay/pairing` | - | `{ link, expiresAt }`: the QR code's link, `<relay>/#pair=<code>.<secret>.<PC key hash>`, usable once for 2 minutes |
| DELETE | `/relay/devices/:id` | - | `{ ok }`: unpairs a phone; this PC refuses it at once, the relay drops its sessions |

Relay mode (`ENCLAVE_PHONE=relay`, Stage 6): the agent keeps one outbound WebSocket to the relay and answers paired phones through an end-to-end encrypted tunnel (specs/relay-protocol.md). Through the tunnel a phone reaches only `GET /v1/profiles`, `POST /v1/profiles/:id/start|stop`, `GET /v1/profiles/:id/stream|media`, `POST /v1/profiles/:id/files`, and running profiles' stream servers (`/neko/<id>/api/...`).

Phone mode (`ENCLAVE_PHONE=tailscale`, Stage 2): `tailscale serve` relays this API and each running profile's stream to the owner's tailnet over HTTPS; the server still binds 127.0.0.1 only. Paths outside `/v1` serve the phone app's static files without a token.

## Behaviors
- `POST /profiles` runs the proxy safety check first; on failure returns 422 with details and creates nothing.
- `start` reruns the safety check; on failure returns 422 and does not start.
- Errors use a consistent shape: `{ error: { code, message, details? } }`.
- Rate limit create/start lightly to avoid hammering Docker.
- Every state change is logged (without secrets) to the profile's log file.

## Error codes
`DOCKER_DOWN`, `PROXY_UNREACHABLE`, `PROXY_LOCATION_MISMATCH`, `IMAGE_NOT_BUILT`, `GPU_UNAVAILABLE` (no graphics card for profiles, or the profile was made on a different one), `PROFILE_NOT_FOUND`, `PROFILE_RUNNING`, `PROFILE_NOT_RUNNING`, `REAL_IP_LEAK_SUSPECTED`, `FILE_PICKER_CLOSED` (a phone file arrived but no file picker is open in the profile), `SECRETS_LOCKED` (the profile's passwords are encrypted for the Windows app and this agent cannot open them, e.g. the CLI), `RELAY_UNREACHABLE` (502: the relay could not be reached or failed), `RELAY_REFUSED` (403: the relay said no, e.g. a wrong password; its message is passed on), `INTERNAL`.

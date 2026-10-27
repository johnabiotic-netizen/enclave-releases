# Agent API

Local HTTP API. Binds `127.0.0.1` only (Stage 2 may also bind the Tailscale interface). All requests require `Authorization: Bearer <AGENT_TOKEN>`. JSON in, JSON out. Types live in `packages/shared`.

Base: `http://127.0.0.1:<port>/v1`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | - | `{ ok, version, dockerOk }` |
| GET | `/profiles` | - | `Profile[]` (without secrets) |
| POST | `/profiles` | `{ name, proxy, template?, useTestProxy? }` | `Profile` (runs safety check, generates fingerprint) |
| GET | `/profiles/:id` | - | `Profile` |
| PATCH | `/profiles/:id` | `{ name?, notes?, idleStopMinutes?, proxy? }` | `Profile` |
| DELETE | `/profiles/:id?confirm=true` | - | `{ ok }` (stops container, removes data; refused without `confirm=true`) |
| POST | `/profiles/:id/start` | - | `{ stream }` after health passes; errors if safety check fails |
| POST | `/profiles/:id/stop` | - | `{ ok }` |
| GET | `/profiles/:id/stream` | - | `{ url, password, expiresAt }` for the viewer |
| POST | `/profiles/:id/check-proxy` | - | `ProxyCheckResult` |
| GET | `/profiles/:id/logs` | `?tail=200` | `{ lines: string[] }` (never includes secrets) |
| GET | `/system` | - | `{ ram: { totalBytes, freeBytes }, profilesRunning, dockerOk, virtualizationOk, imageBuilt }` |

## Behaviors
- `POST /profiles` runs the proxy safety check first; on failure returns 422 with details and creates nothing.
- `start` reruns the safety check; on failure returns 422 and does not start.
- Errors use a consistent shape: `{ error: { code, message, details? } }`.
- Rate limit create/start lightly to avoid hammering Docker.
- Every state change is logged (without secrets) to the profile's log file.

## Error codes
`DOCKER_DOWN`, `PROXY_UNREACHABLE`, `PROXY_LOCATION_MISMATCH`, `IMAGE_NOT_BUILT`, `GPU_UNAVAILABLE` (no graphics card for profiles, or the profile was made on a different one), `PROFILE_NOT_FOUND`, `PROFILE_RUNNING`, `PROFILE_NOT_RUNNING`, `REAL_IP_LEAK_SUSPECTED`, `INTERNAL`.

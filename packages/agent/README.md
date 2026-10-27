# @enclave/agent

The local control service (Node + TypeScript). Manages profile containers, runs the proxy safety check, generates fingerprints, assigns stream ports and passwords, stops idle profiles, and serves the local API (`specs/agent-api.md`) on 127.0.0.1 with token auth. Also the Stage 1 CLI. The desktop app embeds it in Stage 5 (`startAgent` in `src/agent.ts`).

## Run (PowerShell, from the repo root)

```powershell
copy .env.example .env      # then set AGENT_TOKEN (and ENCLAVE_WSL_DISTRO on a PC without Docker Desktop)
npx --yes pnpm@12.15.0 build
node --env-file=.env packages/agent/dist/cli.js serve        # keep this window open
```

In a second window:

```powershell
node --env-file=.env packages/agent/dist/cli.js create "Work" --proxy socks5://user:pass@host:port
node --env-file=.env packages/agent/dist/cli.js list
node --env-file=.env packages/agent/dist/cli.js start <id>    # prints the address and password
node --env-file=.env packages/agent/dist/cli.js open <id>     # same, and opens it in your browser
node --env-file=.env packages/agent/dist/cli.js stop <id>
node --env-file=.env packages/agent/dist/cli.js delete <id> --yes
```

`<id>` can be the first few characters. `enclave --help` lists everything (`check`, `logs`, `--test-proxy`).

The browser image must be built first (`.\scripts\build-image.ps1`). For a test proxy during development, run `scripts/test-proxy.sh` where Docker runs and put the line it prints into `.env`. It exits through this PC's own connection, so profiles made with it are labeled "Test proxy, not for real accounts".

## How it works

| File | Role |
|---|---|
| `src/docker/connect.ts` | Docker Desktop's pipe, or (no Docker Desktop) a private named pipe bridged to Docker Engine in WSL through `wsl.exe docker system dial-stdio` |
| `src/docker/runtime.ts` | Containers, networks, volumes, one-off runs of the image |
| `src/profiles.ts` | Create, start, stop, delete, the idle and proxy watcher |
| `src/proxy.ts` | The three proxy formats and the safety check verdict |
| `src/store.ts` | `<ENCLAVE_HOME>/profiles/<id>/` with `profile.json`, `secrets.json`, `agent.log` |
| `src/server.ts` | The API (Fastify), 127.0.0.1 only, bearer token |
| `src/cli.ts` | `enclave serve` runs the agent; other commands call its API |

The PC's graphics card: profiles render on it and claim it (DECISIONS.md, 2026-10-26). The agent asks Windows for it (`src/gpu.ts`; `ENCLAVE_GPU` picks one on a PC with several), refuses to create a profile when Docker can't hand `/dev/dxg` to containers, saves the card as `fingerprint.webgl.hostAdapter`, and refuses to start a profile on a different card (`GPU_UNAVAILABLE`).

Per profile:
- **Create** runs `check_proxy.py` in a one-off container (the proxy goes in as a file, never as an argument), then `gen_fingerprint.py` with no network, using the exit IP's country, timezone and locale.
- **Start** reruns the check, refuses if the location no longer matches the fingerprint, then creates the container `enclave-<id>` on its own network `enclave-<id>`, with the data volume `enclave-<id>-data` on `/data`, `/config` copied in, `--cap-add NET_ADMIN` for the egress lock, `no-new-privileges`, 3 GB memory, 2 GB shm. Stream ports come in pairs from 52100 to 52999 on 127.0.0.1. Fresh neko passwords every start: the viewer gets the normal one (can control, can't change the screen size); the admin one stays with the agent.
- **Watcher** (every 60 s): stops a profile with no connected viewer for `idleStopMinutes` (default 20), marks "Proxy unreachable" when the proxy stops carrying traffic, and notices a crashed profile.
- **Stop** is graceful (15 s) so Firefox saves its session; the volume keeps tabs, logins and history.

Secrets: proxy passwords and stream passwords live in `secrets.json` per profile (Stage 1; the OS credential store comes in Stage 5) and never in logs or `profile.json`. neko's passwords are also in the container's environment, visible only to someone with Docker access.

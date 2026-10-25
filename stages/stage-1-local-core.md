# Stage 1: Local core

**Goal:** profiles run as Docker containers on the PC, each with a fixed fingerprint and its own proxy, and you can open each one's browser in your normal PC browser through a local address. Sessions survive restarts.

**You are done when** the acceptance tests at the bottom all pass.

## Verify first

Check these against current official sources before building; fix the specs here if reality differs, and log it in `progress/DECISIONS.md`.

- neko v3 base image name, current tag, and how to add a custom browser (supervisord program, env vars for password and screen size, WebRTC/EPR port range).
- Camoufox current version, install method inside a Debian based image, and the Python API to launch headful with (a) a saved fingerprint and (b) a persistent profile directory, running under Xvfb or neko's display.
- Confirm `dockerode` is current and works against Docker Desktop's named pipe on Windows.

## Build tasks

### A. Monorepo skeleton
- [ ] Init pnpm workspace at repo root. `package.json` with workspaces: `packages/*`.
- [ ] Add `packages/shared`: TypeScript types for Profile, Fingerprint, Proxy, ProfileStatus, and agent API request/response types. Export from an index. These types are the contract used everywhere.
- [ ] Root `tsconfig.base.json`, ESLint, Prettier. `.gitignore` (node_modules, dist, .env, profiles/, *.local).
- [ ] `.env.example` with `AGENT_TOKEN=`, `TEST_PROXY=`, `DOCKER_HOST` note for Windows.

### B. Browser image (`images/browser/`)
- [ ] `Dockerfile` based on neko's base image, Camoufox installed at a pinned version.
- [ ] Install Windows font package into the image (prep for Stage 3; at minimum a broad font set now).
- [ ] `start-browser.sh`: reads `/config/profile.json` and `/config/proxy.json`, launches Camoufox with the saved fingerprint, the proxy, and the persistent data dir at `/data`.
- [ ] `gen_fingerprint.py`: prints a validated fingerprint JSON for given `--os windows --country --timezone --locale`.
- [ ] supervisord config so neko serves the Camoufox session.
- [ ] `docker build` succeeds and `docker run` shows a working browser stream on localhost with neko's password.

### C. Egress lock (fail closed)
- [ ] Implement per profile network isolation and the proxy only firewall from `docs/04-security.md`.
- [ ] Entrypoint applies rules before the browser starts.
- [ ] Manual test: break the proxy, confirm no page loads and no real IP anywhere.

### D. Agent (`packages/agent/`)
- [ ] Fastify server bound to `127.0.0.1`, bearer token from `AGENT_TOKEN`.
- [ ] `dockerode` integration.
- [ ] Endpoints per `specs/agent-api.md`: list, create, start, stop, delete profiles; get status; get stream info.
- [ ] Profile store: a `profiles/` directory on the host, one folder per profile id, holding `profile.json` and a Docker volume (or bind mount) for `/data`.
- [ ] Fingerprint generation at create (runs the generator container).
- [ ] Proxy parsing (three formats) and the safety check from `docs/06-proxies.md`.
- [ ] Port and password assignment per profile; health wait on start.
- [ ] Idle stop loop (configurable minutes; default 20).
- [ ] Structured logs to a file in the profile folder; never log secrets.

### E. CLI for Stage 1 (`packages/agent/` bin)
- [ ] `enclave create`, `list`, `start <id>`, `stop <id>`, `open <id>` (prints or opens the local stream URL), `delete <id>`.
- [ ] `open` prints the URL and password so you can paste into a browser.

## Acceptance tests

1. **Create and start:** create a profile with the test proxy, start it, open the URL in your PC browser, see a working Camoufox browser.
2. **Proxy in effect:** inside the profile, an IP check shows the proxy's IP, and its country/timezone match the fingerprint.
3. **Two isolated profiles:** create a second profile with a different proxy. The two show different IPs and different canvas/WebGL values. Neither can see the other's cookies.
4. **Persistence:** log into any test account in profile 1, stop it, restart the PC, start it again. Still logged in, history intact.
5. **Fixed fingerprint:** record profile 1's fingerprint (user agent, canvas hash, WebGL renderer). Stop, start. Values identical.
6. **Fail closed:** break the proxy, start the profile. No page loads, no real IP leak. Restore proxy, pages load again.
7. **Idle stop:** leave a profile with no viewer past the idle timeout. It stops on its own. Data persists.

Record evidence (screenshots or copied values) in `progress/PROGRESS.md` under Stage 1.

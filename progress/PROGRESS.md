# Progress

**Current stage:** Stage 1, Local core. In progress (tasks A and B done).

Update this at the end of every work session. Keep it short and current.

## How to read this
- `[ ]` not started, `[~]` in progress, `[x]` done (with a note on how it was verified).
- When a stage's acceptance tests all pass, mark the stage complete and move "Current stage" to the next one.

## Stage 1: Local core  [~]
Spec: `stages/stage-1-local-core.md`
- [x] A. Monorepo skeleton. Verified 2026-10-25: `pnpm install`, `pnpm build` (shared compiles to `dist/`), `pnpm lint`, `pnpm format:check` and `pnpm test` (3/3 schema contract tests) all pass on Node 24.14.1, pnpm 12.15.0. `.gitignore` and `.env.example` were already correct. Git repo initialised.
- [x] B. Browser image. Verified 2026-10-26 on Docker Engine 29.9.2 in WSL. `scripts/build-image.sh` builds `enclave-browser:dev`, with every download pinned and checksummed. `gen_fingerprint.py` runs with `--network none`, gives 1920x1080 Windows fingerprints, gives two profiles different WebGL and audio seeds, and rejects an IP from the wrong country. A test container behind a password-protected SOCKS5 test proxy runs openbox, the gost forwarder, Camoufox and neko. Through the stream API, the browser loaded api.ipify.org via the proxy, and a test page showed exactly the saved UA, timezone, languages, screen, cores and WebGL, with webdriver=false. With the proxy stopped, pages fail ("Unable to connect"), with no direct fallback. After deleting the container and starting a new one on the same volume, the open tab came back. From Windows, 127.0.0.1:8080 (HTTP 200) and the WebRTC TCP port 52000 are reachable. Still to check by the owner: the live stream in a PC browser.
- [ ] C. Egress lock
- [ ] D. Agent
- [ ] E. CLI
- [ ] Acceptance tests 1 to 7
Notes / evidence:
- (none yet)

## Stage 2: Phone access  [ ]
## Stage 3: Fingerprint hardening  [ ]
## Stage 4: Camera and mic passthrough  [ ]
## Stage 5: Windows app  [ ]
## Stage 6: Phone linking  [ ]
## Stage 7: Launch  [ ]

## Blockers
- (none). Docker resolved 2026-10-26: Docker Desktop can't run on this PC (Windows 11 21H2, which can't be upgraded), so Docker Engine 29.9.2 now runs inside WSL `Ubuntu-24.04` (see DECISIONS.md). Verified: `wsl docker run --rm hello-world` works, and the distro stays running with no terminal open. After a PC restart, run any `wsl` command (e.g. `wsl docker ps`) once to start it.
- Disk space is tight. C: hit 0 GB on 2026-10-26 during an image build, which crashed WSL; clearing the npm cache (6.5 GB) recovered it. WSL's disk (`ext4.vhdx`, about 16 GB) never shrinks by itself. Keep about 8 GB free inside Docker for rebuilds, run `docker builder prune` after builds, and plan to compact the disk (owner step, admin) or free more space on C:.
- For the owner: acceptance test 3 says profiles show different canvas values, but Camoufox no longer adds canvas noise, so canvas is the same across profiles on one image (see DECISIONS.md). Stage 3 decides.

## Notes for upcoming tasks
- Viewer (Stages 4/5): neko's client guesses touch vs mouse from media queries (`client/core/src/client.ts` `isTouchDevice`). The owner's touchscreen PC reports `pointer:fine` false and `hover:hover` false, so the stock web page never focuses its key input: clicks work, typing doesn't. The image now patches the stock page to check `any-pointer`/`any-hover` (Dockerfile); our own viewer should pass `inputMode` to `NekoClient` the same way.
- Task D: WSL shuts down by itself when nothing on Windows uses it (seen 2026-10-26), stopping every container. The agent must keep WSL alive while profiles run (e.g. hold a long-running `wsl.exe` process) and not keep anything in WSL's `/tmp`, which a restart wipes. Also give the owner the non-admin login: with the admin one, the viewer changed the screen to 1920x1200, which breaks the fingerprint.
- Browser image: Camoufox has no default search engine ("Search with None"); typed addresses work, searches don't. Set one in the image.
- Task C: firewall goes in `entrypoint.sh` at the marked spot. Allow only uid 1100 (`egress`, the gost forwarder) to reach the proxy host and port; resolve the proxy hostname before locking (or require an IP).
- Task D: stop containers with `docker stop` (graceful) so Firefox saves the session. Use a Docker volume per profile for `/data` (Firefox's SQLite on a Windows folder is slow and has locking issues). The agent must start the WSL distro (`wsl -d Ubuntu-24.04 true`) before using Docker on the owner's PC.

## Next action
Owner: open the test stream (see the end-of-session summary) to confirm task B visually. Then Stage 1, task C: egress lock (fail closed).

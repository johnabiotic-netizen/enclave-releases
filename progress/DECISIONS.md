# Decision log

One entry per real decision. Newest at the top. Keep each to a few lines: context, decision, reason. Record here whenever you deviate from a spec because reality differed, or when you make a choice the docs left open.

Format:
```
## YYYY-MM-DD  Short title
Context: ...
Decision: ...
Reason: ...
```

---

## 2026-10-26  No canvas seed; fixed 1920x1080 screen for Stage 1
Context: Camoufox 156.0.1-beta.32 removed canvas noise on purpose (Camoufox issue #528; its config marks `canvas:seed` as removed). neko's virtual display only supports a fixed list of sizes (1920x1080, 2560x1440, 1600x900, ...; not 1366x768 or 1536x864).
Decision: `canvasSeed` is now optional in the schema, spec and types, and new fingerprints have none. Canvas output is therefore stable per profile (acceptance test 5) but the same for all profiles on one image (acceptance test 3 asks for different canvas values; flagged for the owner, Stage 3 decides). All Stage 1 fingerprints use a 1920x1080 screen (Camoufox `Screen` bound), and the window is reported maximized in the available area. `hardware.memoryGb` and `geolocation.accuracy` are optional too, because Camoufox doesn't produce them.
Reason: Follow Camoufox's current design rather than re-add a noise layer its authors removed. Stage 3 can add display modes and revisit canvas.

## 2026-10-26  Browser image: verified versions and pins
Context: Stage 1 "Verify first" for neko and Camoufox.
Decision: Base `ghcr.io/m1k1o/neko/base:3.2.0` pinned by digest (Debian 13, Python 3.13, supervisord as root, user `neko` uid 1000, `DISPLAY=:99.0`). Custom programs go in `/etc/neko/supervisord/*.conf` with openbox, as in neko's Firefox app. camoufox Python package 0.5.8 (plus a full `requirements.lock` installed with `--no-deps`), which pins browser build 156.0.1-beta.36. The browser zip, the GeoIP AIO database (release 2026.10.21), uBlock Origin 1.75.0 and gost 3.3.1 are downloaded by exact URL with `ADD --checksum` and laid out the way `camoufox fetch` would, because `fetch` takes "latest" for the add-on and GeoIP. The fpgen model is pinned and checksummed by camoufox itself (`ensure_fpgen_model`). Debian packages are pinned to exact versions; when Debian drops an old version, bump the pin.
Reason: CLAUDE.md requires exact pins, and `camoufox fetch` alone isn't reproducible.

## 2026-10-26  Fingerprint saved as Camoufox's full config; browser launched directly
Context: The fingerprint must never be regenerated (hard rule 2). Camoufox's Python launcher generates a fingerprint and passes it to the browser as `CAMOU_CONFIG_<n>` environment variables, with Firefox prefs in `CAMOU_PREFS_<n>`.
Decision: `gen_fingerprint.py` runs `launch_options()` once at creation and saves the decoded config and prefs as `fingerprint.raw`. `launch_browser.py` rebuilds those environment variables from the saved data and execs `camoufox-bin` directly, with `--profile /data/profile`. Playwright is not used at runtime.
Reason: Replays exactly what was saved, with no generation at launch. A browser for a person doesn't need an automation channel, and normal Firefox session restore keeps working.

## 2026-10-26  Local proxy forwarder (gost) inside each profile container
Context: Firefox can't authenticate to SOCKS5 proxies, and HTTP proxy authentication shows a login dialog.
Decision: gost 3.3.1 runs as a separate `egress` user (uid 1100) and listens on 127.0.0.1:1080 as plain SOCKS5. It forwards to the profile's proxy (socks5, http or https) with the credentials from `/config/proxy.json`. Camoufox uses only that local port, with remote DNS. The gost config holding the password is written to `/run/enclave` and readable only by `egress`.
Reason: Works for every proxy type without dialogs. It also gives task C's firewall one simple rule: only uid 1100 may reach the proxy host and port.

## 2026-10-26  Docker Engine inside WSL instead of Docker Desktop (owner's PC)
Context: The owner's PC runs Windows 11 21H2 (build 22000). Docker Desktop 4.96.3 needs 23H2 (build 22631) or newer, and the Windows 11 Installation Assistant reports the hardware as not compatible, so Windows cannot be upgraded.
Decision: Install WSL 2.7.14 plus an Ubuntu 24.04 distro, and run Docker Engine (pinned versions) inside it. The agent reaches Docker through that engine instead of Docker Desktop's named pipe. Product users on supported Windows may still use Docker Desktop, so the agent must support both connection methods.
Reason: The only supported way to get Docker on this PC. Stage 7 already plans a bundled WSL distro running Docker Engine, so this keeps the product path open.
Installed: WSL 2.7.14 (kernel 6.18.33.2-2), distro `Ubuntu-24.04` (default distro, default user root, systemd on), docker-ce/cli 5:29.9.2, containerd.io 2.4.2, buildx 0.38.1, compose 5.6.1, all held with `apt-mark hold`. `%UserProfile%\.wslconfig` sets `[general] instanceIdleTimeout=-1` so WSL doesn't shut the distro down (and with it all running profiles) after 15 s without a terminal attached. From Windows: `wsl docker <args>`.
Open for task D: how dockerode reaches this engine (the options are a TCP socket on 127.0.0.1 forwarded from WSL, or running `wsl docker` commands), and starting the distro after a reboot (the agent can run `wsl -d Ubuntu-24.04 true` before talking to Docker).

## 2026-10-25  Node 24 LTS instead of Node 20
Context: Docs say Node 20 LTS. Node 20 reached end of life in April 2026; the owner's PC has Node 24.14.1.
Decision: Target Node 24 LTS (`engines: >=24 <25`). Agent and relay use it; Electron (Stage 5) brings its own Node.
Reason: Node 20 no longer gets security fixes. Node 24 is the active LTS line and is already installed.

## 2026-10-25  pnpm through corepack, pinned
Context: pnpm is not installed on the owner's PC.
Decision: Root `package.json` pins `"packageManager": "pnpm@12.15.0"`. Run it as `corepack pnpm <cmd>` (or run `corepack enable` once in an admin PowerShell, then plain `pnpm`).
Reason: No global install needed, and everyone gets the same pnpm version.

## 2026-10-25  Tooling versions for task A
Context: CLAUDE.md requires exact pins. TypeScript 7.0 (the native Go compiler) is out, but typescript-eslint 8.72.0 only supports TypeScript `<6.1`.
Decision: TypeScript 6.0.3, ESLint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.72.0, eslint-config-prettier 10.1.8, Prettier 3.9.10, Vitest 5.0.5, globals 17.13.0, @types/node 24.19.2. Move to TypeScript 7 once typescript-eslint supports it.
Reason: Lint must work. TypeScript 6.0 is the newest version every tool supports.

## 2026-10-25  `@enclave/shared` builds to dist with project references
Context: Consumers include the agent (plain Node), Electron and Vite apps. Node won't strip types inside node_modules, so it can't run `.ts` files from a workspace package.
Decision: `packages/shared` is ESM and compiled by `tsc -b` to `dist/`. Other packages reference it as a TypeScript project reference. `src/contract.test.ts` checks the shared enums against `specs/schemas/profile.schema.json`.
Reason: Works the same for every consumer without extra loaders. The test catches drift between the types and the schema.

## 2026-10-25  Agent API gaps filled
Context: `specs/agent-api.md` did not define the shape of `ram` in `/system` or how DELETE passes its confirm flag.
Decision: `ram` is `{ totalBytes, freeBytes }`. DELETE requires the query `?confirm=true`. The spec is updated to match.
Reason: Simplest shapes. A query flag also works with clients that drop DELETE bodies.

## 2026-10-25  Initial architecture locked
Context: Choosing how PC-to-phone continuity works.
Decision: Profiles run in Docker on the user's PC; phone and PC are both viewers of the one running browser. No profile-data sync between devices.
Reason: Avoids the fingerprint mismatch of syncing a desktop profile onto a mobile browser, keeps running cost near zero, and makes continuity exact (nothing to desync).

## 2026-10-25  Engine choice: Camoufox
Context: Need engine-level fingerprinting without patching Chromium.
Decision: Use Camoufox (Firefox based) as the browser engine.
Reason: Open source, engine-level spoofing, built-in realistic fingerprint generation. Present all profiles as Windows Firefox to avoid engine/UA mismatch.

## 2026-10-25  Streaming: neko v3
Context: Need to view the container browser on PC and phone.
Decision: Build the browser image on neko v3's base image.
Reason: Self-hosted WebRTC streaming, low latency, audio, works in phone browsers; permissive license.

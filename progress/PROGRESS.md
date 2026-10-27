# Progress

**Current stage:** Stage 3, Fingerprint hardening. In progress (2026-10-27). Stage 2, Phone access: complete 2026-10-27. Stage 1, Local core: complete 2026-10-27 (tasks A to E, all seven acceptance tests pass).

Update this at the end of every work session. Keep it short and current.

## How to read this
- `[ ]` not started, `[~]` in progress, `[x]` done (with a note on how it was verified).
- When a stage's acceptance tests all pass, mark the stage complete and move "Current stage" to the next one.

## Stage 1: Local core  [x]
Spec: `stages/stage-1-local-core.md`
- [x] A. Monorepo skeleton. Verified 2026-10-25: `pnpm install`, `pnpm build` (shared compiles to `dist/`), `pnpm lint`, `pnpm format:check` and `pnpm test` (3/3 schema contract tests) all pass on Node 24.14.1, pnpm 12.15.0. `.gitignore` and `.env.example` were already correct. Git repo initialised.
- [x] B. Browser image. Verified 2026-10-26 on Docker Engine 29.9.2 in WSL. `scripts/build-image.sh` builds `enclave-browser:dev`, with every download pinned and checksummed. `gen_fingerprint.py` runs with `--network none`, gives 1920x1080 Windows fingerprints, gives two profiles different WebGL and audio seeds, and rejects an IP from the wrong country. A test container behind a password-protected SOCKS5 test proxy runs openbox, the gost forwarder, Camoufox and neko. Through the stream API, the browser loaded api.ipify.org via the proxy, and a test page showed exactly the saved UA, timezone, languages, screen, cores and WebGL, with webdriver=false. With the proxy stopped, pages fail ("Unable to connect"), with no direct fallback. After deleting the container and starting a new one on the same volume, the open tab came back. From Windows, 127.0.0.1:8080 (HTTP 200) and the WebRTC TCP port 52000 are reachable. Still to check by the owner: the live stream in a PC browser.
- [x] C. Egress lock. Verified 2026-10-26 in WSL: in-container iptables (`apply_egress_lock.sh`) allows only uid 1100 (gost) to the proxy IP:port; Docker's DNS (127.0.0.11), all other IPv4 and all IPv6 are refused. Without `--cap-add NET_ADMIN` the container refuses to start. After setup, supervisord's capability bounding set has no NET_ADMIN/NET_RAW. Tests: direct HTTPS as the browser user, the forwarder user and root all blocked; DNS via Docker and UDP 53 to 8.8.8.8 blocked; through the proxy works; the browser loads pages through the proxy and, with the proxy stopped, loads nothing (no direct fallback); stream ports 8080 and 52000 still reachable from Windows. Owner to confirm the live stream still works.
- [x] D. Agent. Verified 2026-10-26 on the owner's PC (Docker Engine in WSL, reached through `wsl.exe docker system dial-stdio`). With the dev test proxy: create (safety check + fingerprint, 7 s), start (17 s, port 52100), the browser showed the proxy's IP and matching timezone on browserleaks.com/ip with WebRTC showing only that IP; the normal viewer login can take control but changing the screen size is refused (403), screen stays 1920x1080; stop, then start again restored the open tab; start with the proxy down was refused (no container); idle stop with a 1 minute limit stopped the profile at about 1.5 minutes and logged `reason: idle`; restarting the agent kept the running profile tracked; requests without the token get 401; the API listens on 127.0.0.1:8787 only; logs hold no secrets. The agent holds WSL open while it runs.
- [x] E. CLI. `enclave serve | create | list | start | open | stop | check | logs | delete` (`packages/agent/README.md`); used for all the task D checks above.
- [x] Acceptance tests 1 to 7 (evidence below)
Notes / evidence:
- (none yet)

## Stage 2: Phone access  [x]

- [x] `docs/setup/tailscale.md`: PC and phone setup, HTTPS certificates, finding the PC's name.
- [x] Agent phone switch: `ENCLAVE_PHONE=tailscale`. Streams stay bound to 127.0.0.1; `tailscale serve` relays them (DECISIONS.md 2026-10-27: binding to the Tailscale interface is impossible with Docker in WSL).
- [x] Stable Tailscale URL per profile: `https://<pc>.<tailnet>.ts.net:<web port>/` with the per-start password, as `phoneUrl` in `GET /profiles/:id/stream`.
- [x] `packages/mobile`: PWA served by the agent at `https://<pc>.<tailnet>.ts.net:8787/`, paired once with `enclave phone` (QR code, token in the URL fragment). Lists profiles, starts, stops and opens them.
- [x] Mobile viewer: full screen (neko client 3.2.0, touch mode), drag scrolls, tap clicks, long press right-clicks, Back/Forward/Reload/Keyboard/Close bar.
- [x] Sleep and network change: the neko client reconnects; verified 4 reconnects while the browser kept running.
- [x] Home screen (2026-10-27, owner): Android Chrome's "Install" never finished, because Chrome packages installed apps (WebAPK) on a Google server that has to fetch the manifest and icons, and the app is reachable only inside the tailnet. "Add to home screen → Create shortcut" works. A standalone install without that step is possible in Firefox or Samsung Internet; Stage 6 (own phone linking) revisits it.

Stage 2 acceptance evidence (2026-10-27, owner, Android phone V2318, Profile 1 on port 10006):
- Setup found and fixed on the way: only one WebRTC address is used by pion, so phone mode advertises the PC's Tailscale IP only; neko's CORS list must include the PC page's origin too; touches are translated (the profile has no touchscreen). With the PC on the same phone's hotspot, Tailscale went through the London relay (0.4 to 1.7 s round trips); with the PC on another network it connects directly (126 ms).
- Test 1 continuity: half-typed text on the PC was there on the phone (owner). PASS.
- Test 2 same IP: 62.192.100.40 on both (owner; profile forwarder checked). PASS.
- Test 3 no logout: test account still logged in on the phone, no verification prompt (owner). PASS.
- Test 4 input: tap, type, back/forward/reload work; drag scrolls after the gesture fix (owner). PASS.
- Test 5 reconnect: four phone reconnects 12:10 to 12:15 UTC, Camoufox uptime unbroken since 12:08 (log). PASS.
## Stage 3: Fingerprint hardening  [~]

Spec and checklist updated to option A (canvas by Firefox Strict, stock audio, the PC's GPU).
Findings so far (Profile 2, US proxy, Camoufox 158.0-beta.40):
- [x] Fonts: all common Windows fonts present; no Linux-only font visible (test page measuring 22 Linux fonts). CreepJS: "Like Windows 11".
- [x] Emoji: drawn like Segoe UI Emoji after setting Windows Firefox's `font.name-list.emoji` (was Twemoji via Linux's list).
- [x] Geolocation permission: back to ask-first (Camoufox granted it to every site).
- [x] Navigator: webdriver false, Win32 / Windows NT 10.0 x64, build ID 20181001000000, PDF viewer plugins, Microsoft speech voices; workers agree with the page (CreepJS: Windows 10 64-bit, 4 cores, Intel HD 400, high confidence).
- [x] Screen, timezone, Intl, WebRTC (proxy IP and mDNS only): consistent (CreepJS).
- [x] CreepJS WebGL "suspicious capabilities": fixed 2026-10-27. Firefox reads the initial stencil masks from the GL driver (WebGLContextValidate.cpp): Mesa says 255, Windows ANGLE 2147483647. `gl_shim.c` (preloaded into Camoufox) answers as ANGLE. CreepJS on Profile 3: no flag, params (78) hash 9575e698, the same as real Windows Firefox 147 on this PC. Camoufox issue draft no longer needed.
- [x] Audio: not a Linux difference. Real Windows Firefox 147 on this PC gives the same CreepJS sum (35.749972093850374) and the same probe sum (75.83002272993326) as the profiles; CreepJS just lacks this value in its list. Measured by running the PC's Firefox headless with a throwaway profile.
- [x] Notification: websites see "prompt" (permissions.query, all three profiles); "granted" was only on file:// pages.
- [x] Media devices: Camoufox draws a Windows machine's devices at creation (Realtek/Intel SST mics, speakers, matching groups). New profiles always get one built-in camera (`ensure_webcam` in gen_fingerprint.py) for Stage 4 passthrough; Profiles 1 and 2 were made before this and have none. Websites see one mic and, where present, one camera before permission, as in Firefox.
- [x] WebRTC (BrowserLeaks): no leak, only the proxy IP, no local IP, no IPv6.
- [x] Pixelscan: Profile 3 (port 10075) "consistent", all five green incl. "No proxy detected". Profile 2 (port 10050) was flagged "Proxy detected" by its IP. ip-api.com predicts it: 10050 has proxy=true, 10075 proxy=false, hosting=false. Scan of all 100 ports (2026-10-27): clean on both flags DE 10006; UK 10029-10031, 10033, 10035, 10037; most US ports; none in ES, FR, AU; 10038-10043 did not answer.
- [x] amiunique: Windows, Firefox, en, UTC-04:00; "unique", as for nearly every real browser.
- [x] Three profiles (1 DE port 10006, 2 US 10050, 3 US 10075, created 2026-10-27): BrowserLeaks canvas A1A35A2B..., 3157A6A5..., 7910C9B4... (acceptance test 5).
- [x] Baselines: `node --env-file=.env scripts/fingerprint/baseline.mjs <id> [--save]` opens a probe page in the profile and saves/compares `profiles/<id>/baselines/baseline.json` (canvas excepted). Saved for all three. Profile 3 stopped and started: matches (acceptance test 4).
- Acceptance tests 1 to 6 pass on Profile 3. Stage 3 stays open until nothing is flagged (owner, 2026-10-27: perfection is non-negotiable). Still open: (a) WebGL extensions: profiles list 45 for CreepJS, real Windows Firefox 147 on this PC 41; the extra EXT_polygon_offset_clamp did not exist in 147, EXT_depth_clamp depends on the ANGLE version. Needs real Firefox 158 on this PC as the reference (owner permission to run it). (b) Profile 2 sits on a flagged IP (owner: move it to a clean port?). (c) Firefox 159 is out; profiles say 158 (follow Camoufox updates).
- [x] Downloads: now saved to /data/downloads on the profile volume (fixed 2026-10-27); Stage 5 exposes them in Windows.

## Stage 4: Camera and mic passthrough  [ ]
## Stage 5: Windows app  [ ]
## Stage 6: Phone linking  [ ]
## Stage 7: Launch  [ ]

## Blockers
- (none). Docker resolved 2026-10-26: Docker Desktop can't run on this PC (Windows 11 21H2, which can't be upgraded), so Docker Engine 29.9.2 now runs inside WSL `Ubuntu-24.04` (see DECISIONS.md). Verified: `wsl docker run --rm hello-world` works, and the distro stays running with no terminal open. After a PC restart, run any `wsl` command (e.g. `wsl docker ps`) once to start it.
- Disk space is tight. C: hit 0 GB on 2026-10-26 during an image build, which crashed WSL; clearing the npm cache (6.5 GB) recovered it. WSL's disk (`ext4.vhdx`, about 16 GB) never shrinks by itself. Keep about 8 GB free inside Docker for rebuilds, run `docker builder prune` after builds, and plan to compact the disk (owner step, admin) or free more space on C:.
- For the owner: acceptance test 3 says profiles show different canvas values, but Camoufox no longer adds canvas noise, so canvas is the same across profiles on one image (see DECISIONS.md). Stage 3 decides.

## Stage 1 acceptance evidence
- Test 2, proxy in effect (2026-10-26, owner, real HTTP proxy, profile 257c8d81): browserleaks.com/ip showed 62.192.100.40 (the proxy), Germany, Europe/Berlin, matching the fingerprint (de-DE, Europe/Berlin); Accept-Language de-DE; WebRTC public IP = proxy IP, no local IP; no IPv6. PASS.
- Test 5, fixed fingerprint (2026-10-26, owner, same profile, before/after stop and start): canvas signature 3406796772e6374c6d90be480aee81de both times; unmasked WebGL vendor/renderer Google Inc. (NVIDIA) / ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), matching the saved fingerprint. PASS.
- Test 6, fail closed: verified with the dev test proxy (task C and D notes above); start with the proxy down is refused, and with the proxy stopped mid-session the browser loads nothing.
- Test 7, idle stop: verified with the dev test proxy (task D note above).
- Test 1, create and start (2026-10-27, owner): Profile 1 (ea427e56) and Profile 2 (88c2fbfe) created with real proxies and opened in the owner's PC browser via `enclave open`. PASS.
- Test 3, two isolated profiles (2026-10-27, owner; proxies from one provider, ports 10006 and 10050, both checked sticky twice): Profile 1 62.192.100.40 Germany, Europe/Berlin, Accept-Language de-DE; Profile 2 198.145.172.41 USA, America/New_York, en-US. Canvas signatures dfcf5c103131b3f020f6ae85cea99cfb vs b2ee72212d771e72c4ae674df271afbf. Cookies: Profile 2 set httpbin owner=profile2 at 09:44:45; Profile 1 still showed owner=profile1 at 09:45:19 (checked in each profile's own history). WebGL vendor/renderer the same by design (one PC). PASS.
- Test 4, persistence (2026-10-27, owner): logged into a test account in Profile 1, `enclave stop` at 10:03 UTC, Windows rebooted (boot 10:09 UTC), agent and profile started 10:12 UTC. All six tabs restored, still logged in (account overview page), history intact (Ctrl+H lists the pre-restart visits). PASS.
- All seven Stage 1 acceptance tests pass (6 and 7 verified with the dev test proxy, the rest with the owner's real proxies).

## Fixed after acceptance found fingerprint gaps (2026-10-27, owner chose option A)
Verified on the owner's PC with two profiles running side by side (test proxy):
- Renderer pair: plain RENDERER and UNMASKED_RENDERER both "ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar" (was llvmpipe vs GTX 980). Camoufox 158.0-beta.40 / camoufox 0.5.9b5.
- Real GPU: profiles render on the Intel HD Graphics 620 through WSL's D3D12 driver; the claimed GPU is what Windows Firefox reports for it.
- Canvas: browserleaks.com/canvas gave different signatures in the two profiles (79064E37... vs 567543DD...) and a new one after a restart (Firefox Strict canvas randomization).
- Screen and window: page values equal the fingerprint (1920x1080, avail 1920x1032, window 1920x1032 at 0,0; and 1366x768, avail 1366x720, window 1366x720 on the 1368x768 display mode). No title bar or border.
- Touch points 0, cores 4, language en-NG for a Nigerian exit (was pcm-NG), de-DE for Germany, timezone from the proxy.
- Old profiles are refused with "made before profiles used the graphics card"; Profile 1 recreated (ea427e56) with the same German proxy; the old one is "Profile 1 (old)" for the owner to delete.

Still true (not fixable in software):
- WebGL image hash is the same for all profiles on one PC (Strict randomizes 2D canvas, not WebGL drawings), as on one real PC.
- WebGPU reports no adapter ("blocked device"), as Windows Firefox does when it blocklists a driver; real HD 620s usually get one.
- The TCP/IP fingerprint is the proxy server's (most look Linux/"Android"); choose proxies accordingly.

## Notes for upcoming tasks
- Viewer (Stages 4/5): neko's client guesses touch vs mouse from media queries (`client/core/src/client.ts` `isTouchDevice`). The owner's touchscreen PC reports `pointer:fine` false and `hover:hover` false, so the stock web page never focuses its key input: clicks work, typing doesn't. `any-pointer`/`any-hover` are false there too, so the image patches the stock page to always use mouse/keyboard mode (Dockerfile; owner confirmed typing works 2026-10-26). Our own viewer should pass `inputMode` to `NekoClient` from real pointer events, not media queries.
- Browser image: Google is now the default search engine (Camoufox ships with none; `set_search_engine.py`).

## Next action
Stage 1 acceptance complete (2026-10-27). Next: owner's go-ahead for Stage 2 (phone access, `stages/stage-2-phone-access.md`); run its "Verify first" checks before building. Proxies: one provider, ports 10001-10100 (60 US, 10 DE, 10 ES, 10 UK, 10 FR, 3 AU per the owner), all sticky; Profile 1 = 10006, Profile 2 = 10050.

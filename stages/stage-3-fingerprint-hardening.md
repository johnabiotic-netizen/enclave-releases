# Stage 3: Fingerprint hardening

**Goal:** every profile reads as a consistent, ordinary Windows machine on fingerprint checkers, with no Linux or headless tells and no internal contradictions.

**Done when** the checklist in `testing/fingerprint-checklist.md` passes for at least three profiles and baselines are saved.

## Verify first
- Camoufox's current coverage: what it spoofs at engine level vs what you must set (fonts, screen, media devices, WebGL params).
- Whether the neko display size can be set per container to match each profile's screen fingerprint.

## Build tasks
- [ ] Install a complete Windows 10/11 font set in the image and restrict the browser's exposed fonts to that set. Remove Linux only fonts from exposure.
- [ ] Canvas: drawn on the PC's real GPU and randomized by Firefox's Strict fingerprinting protection: different per profile and per site, new each browser start, as for every Firefox Strict user (owner decision 2026-10-26, option A; replaces the per-profile seed).
- [ ] WebGL: vendor and renderer are the PC's real GPU as Windows Firefox names it (all profiles on one PC share it, as on one real PC); parameters and extensions consistent with it. No "Mesa", "llvmpipe", or software renderer strings.
- [ ] AudioContext: stock, no noise (every x86 PC renders the standard probe the same; Firefox adds none). Replaces the per-profile seed (option A).
- [ ] Screen and window: container display and neko size match the fingerprint's screen; `devicePixelRatio`, color depth, available size all consistent.
- [ ] Timezone, locale, languages, geolocation all driven by proxy location; verify no UTC leak from the container.
- [x] Media devices: expose a consistent desktop set (one mic, one camera, one speaker) with generic Windows style labels decided at creation. (Real passthrough comes in Stage 4; here just the device list is consistent.)
- [x] WebRTC: disabled or proxy only; no local/real IP via WebRTC.
- [ ] Fonts, plugins, mimeTypes, navigator properties: no headless or automation markers.
- [x] Save a baseline per profile under `profiles/<id>/baselines/` for regression checks.

## Acceptance tests
Run each profile through CreepJS, BrowserLeaks (all pages), Pixelscan, and amiunique.
1. **OS consistency:** everything says Windows. No Linux strings anywhere.
2. **No automation tells:** no headless, no webdriver, no neko or Xvfb artifacts.
3. **Internal consistency:** timezone matches IP; languages match region; GPU is a plausible Windows GPU; screen values agree with each other.
4. **Stability:** reload and relaunch; values stay identical to the saved baseline, except the canvas, which Firefox Strict renews each start.
5. **Uniqueness:** three profiles produce three distinct canvas fingerprints. WebGL and audio are the same across profiles on one PC by design (option A), and must match what a real Windows PC with this GPU reports.
6. **No WebRTC leak:** BrowserLeaks WebRTC shows only the proxy IP or nothing, never the real IP.

Save screenshots in `progress/PROGRESS.md` under Stage 3.

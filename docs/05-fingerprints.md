# Fingerprints

## Principles

1. **Generated once, saved forever.** At creation, generate a full fingerprint and save it inside `profile.json`. Every launch loads exactly that fingerprint.
2. **Real device templates.** Use Camoufox's built in generator (BrowserForge) which samples from real device distributions. Do not hand mix values.
3. **Windows only (for now).** Every profile presents as a Windows 10 or 11 desktop or laptop running Firefox. Do not present as Chrome; the engine is Firefox and mismatches are detectable.
4. **Location consistency.** Timezone, locale, `Accept-Language`, and geolocation come from the proxy's exit IP location, determined at creation and rechecked at start. If the proxy's location changes, warn the user; never silently change the fingerprint.
5. **Uniqueness across profiles.** No two profiles share a canvas. Canvas comes from Firefox's own Strict-mode canvas randomization (per profile, per site, new each browser start, like every Firefox user with Strict tracking protection), drawn on the PC's real GPU. All profiles on one PC claim that PC's GPU, as Windows Firefox names it (owner decision 2026-10-26, see `progress/DECISIONS.md`).

## What a fingerprint covers

| Surface | Source |
|---|---|
| User agent, platform, `oscpu` | Generator (Windows template) |
| Screen size, available size, color depth, device pixel ratio | Generator; container display resized to match |
| Window outer and inner size | Generator; neko screen size matches |
| Hardware concurrency, device memory where exposed | Generator |
| WebGL vendor, renderer, parameters, extensions | The PC's real GPU as Windows Firefox reports it (`images/browser/gl_info.py`), with Camoufox's recorded parameters for it; rendered on that GPU through WSL's D3D12 driver |
| Canvas | Drawn on the PC's GPU; randomized by Firefox's Strict fingerprinting protection (per profile, per site, per browser start) |
| Audio | Stock: no noise (seed 0), as Firefox renders it on every x86 PC |
| Fonts | Windows font set installed in image; Camoufox font list restricted to Windows fonts |
| Timezone, locale, languages | From proxy IP geolocation |
| Geolocation (if a site asks) | Approximate coordinates of proxy city |
| WebRTC | Disabled or proxy only |
| Media devices list | Consistent with a desktop: one camera, one mic, one speaker, generic labels decided at creation |

## Storage

The fingerprint is stored as the `fingerprint` object in `profile.json`. See `specs/profile-schema.md`. Store whatever object Camoufox needs to reproduce it exactly (serialized generator output plus Camoufox config overrides). Include `generatorVersion` and `camoufoxVersion` so future upgrades can detect drift.

## Upgrades

When Camoufox is upgraded, existing profiles must keep presenting the same fingerprint. Before upgrading the image, run the fingerprint regression check (`testing/fingerprint-checklist.md`) on at least three existing profiles and compare outputs to their saved baselines.

## Generation flow

1. Agent runs: `docker run --rm --network none <browser-image> /opt/session/profile_build.py --os windows --country XX --timezone Area/City --locale xx-XX --ip <proxy exit IP>`. No network: the generator must never look up the PC's real IP. `--ip` is looked up in the GeoIP database bundled in the image.
2. Script prints JSON to stdout.
3. Agent validates against `specs/schemas/profile.schema.json` and saves.

## Testing

See `testing/fingerprint-checklist.md`. Baselines from CreepJS, BrowserLeaks and Pixelscan are saved per profile in `profiles/<id>/baselines/` for regression comparison.

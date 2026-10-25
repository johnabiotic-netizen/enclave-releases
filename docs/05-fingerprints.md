# Fingerprints

## Principles

1. **Generated once, saved forever.** At creation, generate a full fingerprint and save it inside `profile.json`. Every launch loads exactly that fingerprint.
2. **Real device templates.** Use Camoufox's built in generator (BrowserForge) which samples from real device distributions. Do not hand mix values.
3. **Windows only (for now).** Every profile presents as a Windows 10 or 11 desktop or laptop running Firefox. Do not present as Chrome; the engine is Firefox and mismatches are detectable.
4. **Location consistency.** Timezone, locale, `Accept-Language`, and geolocation come from the proxy's exit IP location, determined at creation and rechecked at start. If the proxy's location changes, warn the user; never silently change the fingerprint.
5. **Uniqueness across profiles.** No two profiles share canvas, WebGL, or audio noise seeds.

## What a fingerprint covers

| Surface | Source |
|---|---|
| User agent, platform, `oscpu` | Generator (Windows template) |
| Screen size, available size, color depth, device pixel ratio | Generator; container display resized to match |
| Window outer and inner size | Generator; neko screen size matches |
| Hardware concurrency, device memory where exposed | Generator |
| WebGL vendor, renderer, parameters, extensions | Generator; must be a real Windows GPU combo |
| Canvas noise seed | Generated, unique per profile |
| Audio context noise seed | Generated, unique per profile |
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

1. Agent runs: `docker run --rm <browser-image> python /opt/enclave/gen_fingerprint.py --os windows --country XX --timezone Area/City --locale xx-XX`.
2. Script prints JSON to stdout.
3. Agent validates against `specs/schemas/profile.schema.json` and saves.

## Testing

See `testing/fingerprint-checklist.md`. Baselines from CreepJS, BrowserLeaks and Pixelscan are saved per profile in `profiles/<id>/baselines/` for regression comparison.

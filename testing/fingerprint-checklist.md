# Fingerprint checklist

Run per profile. Save screenshots and key values under `profiles/<id>/baselines/`. Compare to baseline after any relaunch or image change.

## Sites
- CreepJS (overall trust, lies detection, OS consistency)
- BrowserLeaks: IP, WebRTC, Canvas, WebGL, Fonts, JavaScript, Geolocation, Timezone
- Pixelscan (consistency verdict)
- amiunique (uniqueness)
- An independent IP + geo echo (through the proxy)

## Checks
- [ ] IP equals the profile's proxy exit IP. Real IP appears nowhere.
- [ ] WebRTC: no real or local IP. Only proxy IP or nothing.
- [ ] OS reads as Windows everywhere. No "Linux", "X11", "Mesa", "llvmpipe".
- [ ] No automation/headless markers (no webdriver, no neko/Xvfb traces).
- [ ] Timezone matches IP country. Languages match region. Geolocation (if asked) matches proxy city.
- [ ] WebGL vendor/renderer is a real Windows GPU; parameters agree with it.
- [ ] Canvas: unique across profiles, stable within a session, renewed each start (Firefox Strict). Audio: stock (same on every profile, stable).
- [ ] Fonts look like a Windows set; no Linux only fonts exposed.
- [ ] Screen, availHeight, colorDepth, devicePixelRatio all mutually consistent.
- [ ] CreepJS shows no "lies" and a reasonable trust score.
- [ ] Pixelscan verdict: consistent.

## Regression
- [ ] After relaunch: every value matches the saved baseline (canvas excepted: Firefox Strict renews it each start).
- [ ] After a Camoufox/image upgrade: values still match baseline for existing profiles, or the change is understood and the baseline is deliberately updated.

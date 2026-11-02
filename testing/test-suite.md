# Proxy tester and profile audit

Owner decision 2026-10-29: every check run by hand in Stage 3 becomes a built-in test, because accuracy is the goal. Two tools share one engine.

## Principles
- Real profiles are never driven by automation. A test runs in an **audit container**: the same image, the profile's saved fingerprint and proxy, a fresh throwaway data volume, deleted afterwards.
- Results are read from the pages as data (DOM text and our own probe JSON), not from screenshots. A screenshot of each page is kept for a person to look at.
- The audit must not measure itself: the audit launch must report the same probe values as a normal launch of the same profile. This is checked first and whenever the image changes.
- The reference for "looks like Windows" is real Firefox of the same version on the owner's PC (DECISIONS.md 2026-10-27). Its measurements are saved in `testing/reference/` and compared value by value; per-machine values (screen, timezone, the PC's own optional fonts) are excluded.
- Lookups that leave the PC send only an IP address, never proxy credentials.

## Proxy tester
Input: one proxy, a list, or a port range on one host with one login (e.g. 10001-10100).
For each proxy:
1. Safety check (the one every start runs): connects, carries traffic, no real-IP leak, exit IP from two echo services.
2. Location: country, city, timezone, coordinates (bundled GeoIP), ISP and IP type.
3. Speed: connect and round-trip time.
4. Sticky: a second check after N minutes; same exit IP or not.
5. IP-database reputation: ip-api.com (hosting, proxy, mobile) and further sources as configured.
6. Real-site verdict: Pixelscan in an audit container with a temporary fingerprint for that proxy's location (slow: about a minute each; for proxies that pass 1 to 5, or on request).
Output: a table sorted best-first, a JSON report, screenshots.

## Profile audit
Runs in an audit container of the profile. Each check gives pass, fail or "look" (needs a person), with the values behind it.
- Probe (`scripts/fingerprint/probe.html`): navigator, screen, timezone, WebGL parameters and extensions, audio, fonts, voices, media devices, permissions, math; compared with the profile's baseline (canvas excepted) and with the Windows reference.
- Text metrics: widths, glyph bounds and font metrics for common Windows fonts; SVG emoji bounds (the CreepJS SVGRect case); compared with the reference.
- Pixelscan: overall verdict and each card (browser, location, proxy, masking, bot); IP, WebRTC IP, location, IP type.
- CreepJS: lies, headless/stealth scores, WebGL params/exts hashes, audio sum, fonts verdict, worker agreement; params/exts hashes compared with the reference.
- BrowserLeaks: IP, WebRTC (no local IP, proxy IP only), canvas signature (different from other profiles).
- amiunique: OS, browser, language, timezone as detected.
- Canvas across profiles: each profile's website canvas differs from every other's.

## Reports
`%LOCALAPPDATA%\Enclave\reports\<date>-<kind>-<name>\`: `report.json`, `summary.txt`, screenshots. CLI: `enclave proxy-test ...`, `enclave audit <id>`. Windows app (Stage 7): the Proxies screen runs the proxy tester (one proxy per line, a port may be a range; options for the sticky check and Pixelscan; Create profile from a row), and the create wizard's Check proxy shows the same rating (`rateProxy` in packages/shared/src/proxy-test.ts) with a Deep check button (Pixelscan, one proxy). The profile audit has no app screen yet.

## Build order
- [x] A. Audit container: start a profile copy in audit mode, run `audit.py` (Playwright, Camoufox's own launcher path), return JSON, remove it.
- [x] B. Self-check: probe values in audit mode equal a normal launch.
- [x] C. Page readers: probe, text metrics, Pixelscan, CreepJS, BrowserLeaks, amiunique.
- [x] D. Reference: save real Firefox 158 measurements; comparison rules.
- [x] E. `enclave audit <id>`: report and summary.
- [x] F. Proxy tester steps 1 to 5, `enclave proxy-test` (also `--like <profile> --ports A-B`). ip-api.com free tier is plain HTTP: the IP addresses travel unencrypted.
- [x] G. Proxy tester step 6 (Pixelscan per proxy, `--pixelscan`): temporary profile, Pixelscan-only audit, deleted; one retry. Port 10079 read "consistent", as by hand.
- [ ] H. Agent API endpoints for the Windows app (specs/agent-api.md).

## Status (2026-10-29)
- Self-check: the probe in audit mode equals a normal launch of Profile 3 in all 88 values (webdriver false in both).
- Full audit of Profile 3: 8 checks in about 3 minutes; 24 pass, 57 fail (text metrics: Linux FreeType vs Windows DirectWrite, the enclave-camoufox build targets them), BrowserLeaks WebRTC now read correctly.
- Readers have unit tests built from captured page text (`packages/agent/src/audit-readers.test.ts`).
- Audit containers use Playwright's regular launch (a temporary profile), as Camoufox's launcher does; the persistent-profile launch hung in Juggler.

## Third-party sites
The real-site checks depend on Pixelscan, CreepJS, BrowserLeaks and amiunique keeping their pages; a reader that no longer finds its fields reports "look", not pass. Check each site's terms before the product ships these checks; prefer an official API where one exists (docs/08).

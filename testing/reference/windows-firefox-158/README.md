# Reference: Windows Firefox 158 on the owner's PC

What a real visitor with this hardware shows, used by the profile audit (`testing/test-suite.md`) to judge "looks like Windows" value by value.

How it was measured (2026-10-27):
- Firefox 158.0, official Mozilla build `Firefox Setup 158.0.exe` (SHA-256 checked against Mozilla's SHA256SUMS), unpacked with `/ExtractDir`, not installed. Camoufox v158.0-beta.40 is built on Firefox 158.0.
- Run headless with a throwaway profile over WebDriver BiDi; pages: `images/browser/audit/*.html` and CreepJS.
- PC: Windows 11 21H2, Intel HD Graphics 620 (the GPU the profiles render on and claim), 4 cores, 1366x768 screen, timezone Africa/Lagos, en-US.

Files:
- `probe.json`: `images/browser/audit/probe.html`.
- `metrics.json`: `images/browser/audit/metrics.html` (widths, glyph bounds, font metrics at 100px).
- `svg-emoji.json`: `images/browser/audit/svg-emoji.html` with the PC's own Segoe UI Emoji (2023 version).
- `svg-emoji-current-font.json`: the same page with the current Windows 11 Segoe UI Emoji (the one in Camoufox's bundle, which profiles use) loaded as a web font under the family name "Segoe UI Emoji", so it replaces the PC's older one without changing the font order (measured again 2026-10-30; the first version put the web font first in the list, which also drew ©, ® and ™ with it).
- `creepjs.json`: CreepJS values taken from that run.

Not comparable (machine or run specific, excluded from comparison): `navigator.webdriver` (the reference was automated), screen and window sizes, timezone and offsets, language, canvas (each Firefox Strict profile differs), media devices (each profile has its own set), CreepJS headless scores (the reference ran headless), fonts the PC happens to have installed.

Measure again when Camoufox moves to a new Firefox version, with that version's official build.

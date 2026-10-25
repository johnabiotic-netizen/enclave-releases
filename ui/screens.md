# Screens

Build these in Stage 5 (desktop) and across Stages 2/4/6 (phone). Each screen lists purpose, elements, and states. Follow `design-system.md` and `copy-guidelines.md`.

## Desktop

### 1. Setup checker (first screen until setup is clean)
- Purpose: get the user to a working state.
- Elements: a checklist (Docker installed, Docker running, virtualization on, WSL ok, browser image built), each row green or with a "Fix" expander holding exact steps, and a Recheck button.
- States: all pass -> "You're ready" and a button to the dashboard. Any fail -> show fixes. Image building -> progress bar with the "first launch builds the browser, 5 to 10 minutes" explanation.

### 2. Dashboard (profiles)
- Purpose: see and control all profiles.
- Elements: profile grid of tiles. Each tile: name, status word, status seam, exit IP (monospace) and its country flag, last used, and a primary action (Start when stopped, Open when running), plus a menu (Stop, Edit, Duplicate, Delete). A "Create profile" tile or button.
- States: empty (one calm invitation to create the first profile), populated, a profile in each state.

### 3. Create / edit profile wizard
- Steps: Name and notes -> Proxy (paste any of the three formats; a Check button runs the safety check and shows exit IP, country, timezone; a "Use built in test proxy" toggle) -> Device template (optional: pick a Windows device class, or Auto) -> Review (shows the detected location that the fingerprint will match) -> Create.
- States: proxy check in progress, proxy ok (green with details), proxy failed (clear reason and what to try), location mismatch warning on edit.

### 4. Profile viewer
- Purpose: use the browser.
- Elements: embedded stream filling the area, a thin top bar (profile name, status seam, exit IP, "Open on phone" button, Stop), simple nav controls if needed. "Open on phone" shows a QR (Stage 6) or the Tailscale URL (Stage 2).
- States: connecting, running, proxy lost (banner: "Proxy unreachable, pages will not load"), stopped.

### 5. Settings
- Default idle timeout, data location, default proxy, phone access (Tailscale or paired devices), resource usage (RAM per profile, total), and an About section with versions and third party notices.

### 6. Devices (Stage 6)
- List paired phones, last seen, and a Revoke button each. A "Pair a phone" button showing the QR.

## Phone (PWA)

### P1. Connect / profiles
- After pairing (or over Tailscale), a single column list of the account's profiles with status and exit IP. Tap to open.

### P2. Viewer
- Full screen stream. Thin bottom control bar: back, forward, reload, keyboard toggle, and a camera indicator. Pull to reconnect.

### P3. Camera share (Stage 4)
- Appears when a profile's page requests the camera. Live preview, front/back switch, a clear "Camera is live in <profile>" banner, and a Stop sharing button.

### P4. Pairing (Stage 6)
- Scan the QR shown on the PC. Success and failure states.

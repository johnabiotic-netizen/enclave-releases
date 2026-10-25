# Stage 2: Phone access

**Goal:** open a running profile from your phone and continue the exact same session. The browser keeps running on the PC; the phone is a screen.

**Done when** you can start a profile on the PC and pick it up on the phone, same tabs and logins, with no logout.

## Verify first
- Current Tailscale setup for Windows and for a phone.
- Whether to expose streams via `tailscale serve` or by binding neko ports to the Tailscale interface. Pick the simpler reliable option; log it.

## Build tasks
- [ ] Write `docs/setup/tailscale.md`: install Tailscale on PC and phone, same account, find the PC's Tailscale IP or MagicDNS name. Click by click, with screenshots placeholders.
- [ ] Agent: add a config switch for bind address (`127.0.0.1` vs Tailscale interface). Default stays loopback; phone mode opts in.
- [ ] Ensure each profile's stream is reachable at a stable Tailscale URL with its per profile password.
- [ ] `packages/mobile`: minimal PWA that lists profiles (from the agent API over Tailscale, token protected) and opens a chosen profile's neko stream full screen. Installable to the home screen.
- [ ] Mobile viewer: full screen, correct touch input, on screen controls for back/forward/reload, and a keyboard toggle.
- [ ] Handle phone sleep and network change: reconnect the stream cleanly without reloading the PC browser.

## Acceptance tests
1. **Continuity:** on PC, open a page and type into a form without submitting. On the phone, open the same profile. The half typed text is there.
2. **Same IP:** an IP check shows the same proxy IP on phone and PC.
3. **No logout:** a logged in account (e.g. a test Google account) stays logged in when viewed on the phone; no verification prompt caused by the switch.
4. **Input works:** you can scroll, tap, type and navigate from the phone.
5. **Reconnect:** lock the phone, reopen. The stream resumes; the PC session never reset.

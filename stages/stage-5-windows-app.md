# Stage 5: Windows app

**Goal:** a real desktop app replaces the CLI. It runs the agent inside itself, manages profiles with a full UI, embeds the viewer, and guides setup.

**Done when** a non technical user can install, create a profile and use it without touching a terminal (Docker still required until Stage 7).

## Verify first
- Current Electron version and safe `safeStorage` usage for secrets on Windows.
- Best way to embed the neko stream in a renderer (webview/iframe) with input and audio.

## Build tasks
- [ ] `packages/desktop`: Electron + React + Vite + TypeScript.
- [ ] Embed the agent in the main process (reuse `packages/agent`). No separate terminal.
- [ ] Build all screens from `ui/screens.md` following `ui/design-system.md` and `ui/copy-guidelines.md`:
  - Dashboard (profile list with status)
  - Create/Edit profile wizard (name, proxy, template, test proxy toggle)
  - Profile viewer (embedded stream, toolbar, "open on phone" with QR placeholder for Stage 6)
  - Settings (idle timeout, default proxy, data location, phone access)
  - Setup checker
- [ ] **Setup checker**: detects Docker installed and running, virtualization enabled, WSL ok, image built. For each failure, show the exact fix (mirror `docs/setup/windows-setup.md`), with a Recheck button.
- [ ] Secrets in `safeStorage`. Agent token generated on first run.
- [ ] First run: builds the browser image with a progress UI (the 5 to 10 minute step), clearly explained.
- [ ] Idle stop and resource display (RAM per profile, total).
- [ ] Packaging with electron-builder into an installer (unsigned here; signing is Stage 7).
- [ ] Playwright smoke tests for the main flows.

## Acceptance tests
1. Fresh Windows VM with only Docker Desktop installed: install the app, follow the setup checker, create and run a profile, all without a terminal.
2. Create, start, view, stop, delete all work from the UI.
3. Secrets are not stored in plaintext on disk.
4. Closing the app stops profiles cleanly (or offers to keep them running, your choice; document it).
5. The UI matches the design system and copy rules.

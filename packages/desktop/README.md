# @enclave/desktop

The Windows app (Electron, React, Vite, TypeScript). The agent runs inside its main process; the
window reaches it only through the preload bridge. Screens follow `ui/screens.md`,
`ui/design-system.md` and `ui/copy-guidelines.md`.

## Run from the repo

```
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 --filter @enclave/desktop exec electron .
```

A developer run reads the repo's `.env` (Docker in WSL, phone mode, test proxy). Close any other
Enclave first: the agent's port (8787) can only be used once.

## Build the installer

```
npx --yes pnpm@12.15.0 build
npx --yes pnpm@12.15.0 --filter @enclave/desktop dist
```

`release/Enclave-Setup-<version>.exe` installs for the current Windows user (no admin) into
`%LOCALAPPDATA%\Programs\Enclave`, with Start menu and desktop shortcuts. It is not signed yet
(Stage 7), so Windows SmartScreen warns before the first run: More info, then Run anyway.

The main process is bundled with the agent and all its packages (`build.mjs`), so the installed
app needs no `node_modules`. The phone app and the Windows Firefox reference ship as resources.

## Data

- `%LOCALAPPDATA%\Enclave`: profiles, `app-settings.json`, reports (the same folder the CLI uses).
- `%APPDATA%\Enclave`: the window's own data, including the key safeStorage encrypts every
  secret with. Fixed in `main.ts`; never move it (DECISIONS 2026-11-01).

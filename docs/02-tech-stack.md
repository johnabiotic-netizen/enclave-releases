# Tech stack

Pin exact versions when you install anything. Record chosen versions in `progress/DECISIONS.md`.

| Area | Choice | Why |
|---|---|---|
| Browser engine | **Camoufox** (Firefox based) | Open source, engine level fingerprint control, built in realistic fingerprint generation (BrowserForge). Avoids patching Chromium C++. License MPL 2.0. |
| Streaming | **neko v3** (`ghcr.io/m1k1o/neko`) | Self hosted browser streaming over WebRTC, low latency, audio, works in phone browsers. Apache 2.0. Built from its base image with Camoufox added. |
| Containers | **Docker Desktop, WSL 2 backend** | Standard on Windows. Stage 7 may replace it with a bundled WSL distro running Docker Engine or Podman. |
| Agent | **Node.js 20 LTS + TypeScript**, `dockerode`, Fastify | Same language as the desktop app, so it embeds cleanly in Electron later. |
| Fingerprint generator | Python inside the browser image (Camoufox, BrowserForge) | Keeps Python off the Windows host. Run as a one off container. |
| Desktop app | **Electron + React + TypeScript + Vite** | Node built in, mature, easy for Claude Code. Tauri considered; rejected because the agent is Node. |
| Phone | **PWA** (React + Vite) | Camera and mic available in phone browsers. Native app only if PWA limits block us. |
| Relay | Node + Fastify + `ws`, deployed to Railway or Fly.io | Small, cheap, stateless where possible. |
| TURN | **coturn** | Standard, open source. |
| Remote access before Stage 6 | **Tailscale** | Free for personal use, zero config private network. |
| Monorepo | **pnpm workspaces** | One repo, shared types between agent, desktop, mobile, relay. |
| Shared types | `packages/shared` (create in Stage 1) | Profile types, API types, relay message types. |
| Tests | Vitest (unit), Playwright (UI, Stage 5) | |
| Lint and format | ESLint + Prettier | |

## Verify first (things that may have changed)

- Camoufox: install method, current Python API for launching with a saved fingerprint and a persistent data directory, and whether a headful launch inside Xvfb works as expected.
- neko v3: base image name and tags, how custom browsers are added (supervisord program config), environment variable names for passwords, screen size, WebRTC ports, ICE servers.
- Docker Desktop: current license terms (free for personal use and small businesses; paid for larger companies).
- WSL kernel: confirm whether `v4l2loopback` is available (assumed not).

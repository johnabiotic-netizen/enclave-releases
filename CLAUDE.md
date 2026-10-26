# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

You are building **Enclave** (working name), a private browser for Windows where every profile runs in its own sealed container with its own fixed device fingerprint and its own proxy. A profile started on the PC can be continued on a phone in the exact same session: same tabs, same logins, same IP, same fingerprint. The phone is only a screen. The browser keeps running on the PC.

The owner (Prince) will use it personally first, then sell it. Build for personal use first, but never make choices that block the product version.

## Read before doing anything

1. `progress/PROGRESS.md` tells you the current stage and what is done. Always start here.
2. `docs/01-architecture.md` explains how all parts fit together.
3. The spec for the current stage in `stages/`.
4. `progress/DECISIONS.md` lists decisions already made. Do not reverse them silently.

Read other docs only when the current task needs them (UI work needs `ui/`, profile work needs `specs/profile-schema.md` and `docs/05-fingerprints.md`, and so on).

## How to work

- Work **one stage at a time, in order**. Do not start a stage until the previous stage's acceptance tests pass, unless the owner says so.
- Inside a stage, work task by task from the checklist. After each task, tick it in `progress/PROGRESS.md`.
- **Verify before you build.** Every stage has a "Verify first" section listing facts about third party tools (Camoufox, neko, Docker Desktop, WSL) that may have changed since these docs were written. Check them against current official docs or by running commands. If reality differs from the spec, follow reality, then record the difference in `progress/DECISIONS.md`.
- Pin every dependency to an exact version. Never use `latest` tags in Dockerfiles or package files.
- When a choice is not covered by the docs, pick the simplest option that keeps the product path open, record it in `progress/DECISIONS.md` (one short entry: context, decision, reason), and continue. Ask the owner only when the choice is expensive to undo.
- Keep commits small, with clear messages, one task per commit when practical.
- At the end of each work session, update `progress/PROGRESS.md` with what changed, what is next, and any blockers.

## The owner's environment

- Windows 10 or 11, 64 bit, Docker Desktop with the WSL 2 backend. **Exception, the owner's own PC:** it runs Windows 11 21H2, which is too old for Docker Desktop and can't be upgraded. It runs Docker Engine inside the WSL distro `Ubuntu-24.04` instead (see `progress/DECISIONS.md`). From Windows, use `wsl docker <args>`; there is no `docker.exe` on PATH. In Git Bash, set `MSYS_NO_PATHCONV=1` when passing `/mnt/c/...` paths to `wsl.exe`. The agent must support both Docker Desktop and Docker Engine in WSL.
- Commands you give the owner must work in **PowerShell** unless you say otherwise. Inside containers, bash is fine.
- The owner is technical but not a systems engineer. When something needs a manual step on Windows (BIOS, Docker settings, installing Tailscale), write exact click by click instructions.

## Repository layout

```
enclave/
  CLAUDE.md               this file
  README.md               human overview and quickstart
  docs/                   vision, architecture, stack, security, fingerprints, proxies, legal
  stages/                 one spec per build stage, with tasks and acceptance tests
  ui/                     design system, screens, flows, UI copy rules
  specs/                  profile schema, agent API, relay protocol, JSON schemas
  testing/                test plan, fingerprint checklist
  progress/               PROGRESS.md (status) and DECISIONS.md (decision log)
  images/browser/         Docker image: Camoufox + neko streaming
  packages/shared/        shared TypeScript types (the contract, see below)
  packages/agent/         local control service (Node + TypeScript): manages containers and profiles
  packages/desktop/       Windows app (Electron + React + TypeScript), Stage 5
  packages/relay/         pairing and signaling server for phone linking, Stage 6
  packages/mobile/        phone PWA, Stage 4 onward
  scripts/                PowerShell and bash helper scripts
  .claude/commands/       custom slash commands for this project
```

`STRUCTURE.md` maps every doc file. Any user-facing text (UI, CLI messages, errors) follows `ui/copy-guidelines.md`.

The empty nested `enclave/` folder is a leftover; check with the owner before deleting it.

## Commands

pnpm workspace (`packages/*`) on Node 24 LTS. pnpm is pinned in `package.json` (`packageManager`) and is not installed globally, so prefix commands with `npx --yes pnpm@12.15.0` (or `corepack pnpm`, which can be slow to download the first time). Below, `pnpm` means that prefix.

- `pnpm install`: install everything.
- `pnpm build` / `pnpm typecheck`: `tsc -b` (project references; `@enclave/shared` compiles to `dist/`, so build it before running dependents).
- `pnpm lint`, `pnpm format:check`, `pnpm format` (Prettier skips `*.md` so hand-written docs are left alone).
- `pnpm test`: Vitest over `packages/*/src/**/*.test.ts`. One file: `pnpm exec vitest run packages/shared/src/contract.test.ts`. One test by name: add `-t "<name>"`.
- Add dependencies with exact versions (`saveExact` is set in `pnpm-workspace.yaml`).

- Browser image: `.\scripts\build-image.ps1` (PowerShell) or `scripts/build-image.sh` (where `docker` runs; on the owner's PC that's inside WSL as root). Tag `enclave-browser:dev`. Large downloads are cached in `/var/cache/enclave/<stage>/`. Run `docker builder prune` after big rebuilds: disk on the owner's PC is tight. Runtime contract and known gaps: `images/browser/README.md`.
- Stage 1 CLI (in `packages/agent`): `enclave create | list | start <id> | stop <id> | open <id> | delete <id>`.
- Config comes from `.env` (copy `.env.example`): `AGENT_TOKEN`, `AGENT_PORT` (default 8787), `TEST_PROXY`. On Windows, dockerode uses Docker Desktop's named pipe, so `DOCKER_HOST` is normally unset.

## Architecture essentials

- **The browser never moves.** Each profile is one running container (neko v3 base + Camoufox). The PC viewer and the phone are both WebRTC viewers of that same instance. Nothing syncs between devices. This is a locked decision in `progress/DECISIONS.md`.
- **The agent is the only orchestrator.** It talks to Docker via `dockerode`, owns the `profiles/<id>/` store on the host (`profile.json` plus the `/data` volume), runs the proxy safety check before every start, assigns stream ports and passwords, and stops idle profiles (default 20 minutes). In Stage 5 the same code is embedded in the Electron main process, so keep it free of CLI-only assumptions.
- **Python stays inside the image.** The agent produces fingerprints by running `gen_fingerprint.py` in a one-off container. Do not add a Python dependency on the Windows host.
- **Config is mounted, not baked.** Proxy and fingerprint go to the container through `/config/profile.json` and `/config/proxy.json`. The entrypoint applies the egress firewall *before* `start-browser.sh` launches Camoufox.
- **`packages/shared` is the contract.** Types for Profile, Fingerprint, Proxy, API, and relay messages live there and must match `specs/profile-schema.md`, `specs/schemas/profile.schema.json`, `specs/agent-api.md` and `specs/relay-protocol.md`. Change the spec and the types together.
- **The relay (Stage 6) never sees browsing data.** It only pairs devices and carries signaling. The agent connects to it outbound only.

## Hard rules

1. **Profiles never leak.** A profile's traffic must only ever leave through its own proxy. If the proxy fails, the profile must fail closed (no traffic), never fall back to the real connection. See `docs/04-security.md`.
2. **Fingerprints are fixed.** A profile's fingerprint is generated once at creation and saved. It is never regenerated on launch. See `docs/05-fingerprints.md`.
3. **Consistency over randomness.** Timezone, language and geolocation must match the proxy's location. OS, fonts, screen and GPU must match a real device template.
4. **Local control API binds to 127.0.0.1 only** and requires a token. Never expose it on 0.0.0.0.
5. **Secrets never go in the repo.** Proxy passwords, tokens and keys go in `.env` (git ignored) during development and in the OS credential store in the desktop app.
6. **No identity verification bypass features.** Camera and microphone passthrough exists so the user can use their real phone camera and mic inside a profile. Do not build, research or suggest anything whose purpose is to defeat identity verification, liveness checks, or virtual camera or injected stream detection. If the owner asks for that, decline and explain this rule.
7. Do not add telemetry, analytics or remote logging without the owner's explicit approval.

## Definition of done for any task

- Code builds and runs on the owner's Windows setup.
- The relevant acceptance test in the stage spec passes, and you say how you checked it.
- `progress/PROGRESS.md` is updated.
- Any new decision is in `progress/DECISIONS.md`.

## Custom commands

- `/status` summarizes progress and the next task.
- `/next` picks up the next unchecked task in the current stage and does it.
- `/verify-stage` runs the current stage's acceptance tests and reports results.
- `/decision` records a decision in the decision log.

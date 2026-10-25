# Progress

**Current stage:** Stage 1, Local core. In progress (task A done).

Update this at the end of every work session. Keep it short and current.

## How to read this
- `[ ]` not started, `[~]` in progress, `[x]` done (with a note on how it was verified).
- When a stage's acceptance tests all pass, mark the stage complete and move "Current stage" to the next one.

## Stage 1: Local core  [~]
Spec: `stages/stage-1-local-core.md`
- [x] A. Monorepo skeleton. Verified 2026-10-25: `pnpm install`, `pnpm build` (shared compiles to `dist/`), `pnpm lint`, `pnpm format:check` and `pnpm test` (3/3 schema contract tests) all pass on Node 24.14.1, pnpm 12.15.0. `.gitignore` and `.env.example` were already correct. Git repo initialised.
- [ ] B. Browser image
- [ ] C. Egress lock
- [ ] D. Agent
- [ ] E. CLI
- [ ] Acceptance tests 1 to 7
Notes / evidence:
- (none yet)

## Stage 2: Phone access  [ ]
## Stage 3: Fingerprint hardening  [ ]
## Stage 4: Camera and mic passthrough  [ ]
## Stage 5: Windows app  [ ]
## Stage 6: Phone linking  [ ]
## Stage 7: Launch  [ ]

## Blockers
- Docker Desktop is not installed on the owner's PC (no `docker` on PATH). Needed for task B onward. Install steps: `docs/setup/windows-setup.md`.

## Next action
Stage 1, task B: browser image. First do the "Verify first" checks for neko v3 and Camoufox. Needs Docker Desktop installed.

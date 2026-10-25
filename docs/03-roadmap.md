# Roadmap

Stages run in order. Each has a full spec in `stages/`. Status lives in `progress/PROGRESS.md`, not here.

| # | Stage | Outcome | Spec |
|---|---|---|---|
| 1 | Local core | Profiles in Docker on the PC, fixed fingerprint, proxy per profile, viewed in PC browser | `stages/stage-1-local-core.md` |
| 2 | Phone access | Profiles opened from the phone through Tailscale | `stages/stage-2-phone-access.md` |
| 3 | Fingerprint hardening | Profiles pass fingerprint checkers as consistent Windows machines | `stages/stage-3-fingerprint-hardening.md` |
| 4 | Camera and mic passthrough | Live phone camera and mic inside a profile | `stages/stage-4-camera-mic-passthrough.md` |
| 5 | Windows app | Electron app with full UI, embedded agent | `stages/stage-5-windows-app.md` |
| 6 | Phone linking | QR pairing, relay, TURN; no Tailscale | `stages/stage-6-phone-linking.md` |
| 7 | Launch | Easy installer, signing, backups, licensing, payments | `stages/stage-7-launch.md` |

**Milestone A (end of Stage 4):** complete personal tool.
**Milestone B (end of Stage 7):** sellable product.

## Later ideas (not scheduled)

- Cloud mode: run a profile on a rented server when the PC is off.
- Team sharing: invite a teammate to a profile with view or control rights.
- Profile templates and bulk creation.
- Import and export of profiles between PCs (encrypted).
- macOS host support.

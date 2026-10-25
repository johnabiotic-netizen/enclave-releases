# Enclave (working name)

Private, sealed browser profiles for Windows that you can continue on your phone without ever changing environment.

Each profile:

- runs in its own isolated Docker container on your PC
- has its own fixed device fingerprint (looks like one consistent Windows computer, forever)
- goes through its own proxy (one stable IP per profile)
- keeps its logins, cookies and open tabs across restarts
- can be opened from your phone, where you see and control the exact same running browser, including live camera and mic from the phone

## How to build this with Claude Code

1. Install Git, Node.js 20 LTS, Docker Desktop (WSL 2 backend) and Claude Code.
2. Open PowerShell in this folder and run `claude`.
3. Say: **"Read CLAUDE.md and progress/PROGRESS.md, then start the current stage."**
4. Use `/status` any time to see where things stand, and `/next` to continue.

Claude Code works through the stages in `stages/` in order. Each stage ends with acceptance tests you can check yourself.

## Stages at a glance

| Stage | What you get | Rough time |
|---|---|---|
| 1. Local core | Profiles running in Docker on your PC, viewed in your PC browser | 1 to 3 weeks |
| 2. Phone access | Same profiles opened from your phone through Tailscale | a few days |
| 3. Fingerprint hardening | Profiles pass as consistent, ordinary Windows machines | 2 to 3 weeks |
| 4. Camera and mic | Phone camera and mic usable live inside a profile | 2 to 4 weeks |
| 5. Windows app | Proper desktop app instead of scripts | 3 to 5 weeks |
| 6. Phone linking | QR pairing and relay server, no Tailscale needed | 3 to 5 weeks |
| 7. Launch | Easy installer, code signing, backups, payments | varies |

After Stage 4 you have a complete personal tool. After Stage 7 you have a product.

## Requirements to run it

- Windows 10 or 11, 64 bit, with virtualization enabled
- 16 GB RAM recommended (each running profile uses about 1 to 2 GB)
- Docker Desktop
- One proxy per profile (static residential or ISP proxies recommended)

## Where to look

- Big picture: `docs/00-vision.md` and `docs/01-architecture.md`
- What to build next: `progress/PROGRESS.md`
- How it should look: `ui/`

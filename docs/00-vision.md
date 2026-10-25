# Vision

## The problem

People who manage several online identities or client accounts (social media managers, agencies, freelancers, e-commerce sellers running several stores) need each account to live in its own clean browser environment. They also need to keep working when they step away from the desk. Today they either stay chained to one computer, or they log in again on their phone, which looks like a new device, triggers security checks, and links accounts that should stay separate.

## The product

A Windows app that runs each browser profile in a sealed container on the user's own PC. Every profile has a fixed fingerprint and its own proxy, so to every website it looks like one ordinary, consistent Windows computer with one stable IP. The user can open any running profile from their phone and continue exactly where they left off, because the phone only streams the browser that is still running on the PC. Nothing changes from the website's point of view.

## Who it is for

1. **Prince, personally (first user).** Manages multiple client and personal accounts. Wants to move between PC and phone freely.
2. **Social media and marketing agencies.** Each client's accounts in a separate profile, accessible from anywhere.
3. **Freelancers and operators** handling several accounts on platforms that tie sessions to devices.

## Core promises

- **Same environment, every time.** Same fingerprint, same IP, same logins, on PC or phone.
- **Truly continuous.** Open tabs, half typed forms and paused videos are still there on the phone, because the browser never stopped.
- **Live phone camera and mic.** When a site in a profile needs the camera, the phone's real camera streams into it live.
- **Private by design.** Profiles run on the user's own machine. No browsing data is stored on our servers.

## What it is not

- Not a tool for defeating identity verification or liveness checks. See `08-legal-and-acceptable-use.md`.
- Not a promise that platforms will allow multiple accounts. Platform rules still apply to the user.

## Competitive position

Established antidetect browsers (Multilogin, GoLogin, AdsPower, Dolphin Anty, Kameleo) are mostly desktop apps with cloud profile sync. Our edge:

1. **Live continuation on the phone** of the actual running session, not a resynced copy.
2. **Live camera and mic passthrough** from the phone.
3. **Easier setup** than tools that make users wrestle with Docker and WSL (Stage 7 goal).
4. **Low running cost** because the user's PC does the work, which allows aggressive pricing.

## Success criteria for the personal version (end of Stage 4)

- Prince uses it daily for at least two weeks for real work.
- No profile ever gets logged out because of an environment change when switching between PC and phone.
- Fingerprint checkers show every profile as a consistent Windows machine.

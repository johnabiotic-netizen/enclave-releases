# Folder map

```
enclave/
  CLAUDE.md                      how Claude Code should work in this repo (read first)
  README.md                      human overview and quickstart
  STRUCTURE.md                   this file
  THIRD_PARTY_NOTICES.md         licenses to maintain
  .env.example                   copy to .env, fill secrets
  .gitignore

  docs/
    00-vision.md                 what and why, who it is for
    01-architecture.md           how all parts fit, with a diagram and flows
    02-tech-stack.md             chosen tools and "verify first" notes
    03-roadmap.md                the seven stages at a glance
    04-security.md               threat model, egress lock, hardening
    05-fingerprints.md           how fingerprints are generated, stored, kept fixed
    06-proxies.md                proxy rules, formats, safety check
    07-glossary.md               plain definitions
    08-legal-and-acceptable-use.md  licenses, acceptable use, payments, the guardrail
    setup/windows-setup.md       user-facing Windows + Docker setup

  stages/
    stage-1-local-core.md        build order starts here
    stage-2-phone-access.md
    stage-3-fingerprint-hardening.md
    stage-4-camera-mic-passthrough.md
    stage-5-windows-app.md
    stage-6-phone-linking.md
    stage-7-launch.md

  specs/
    profile-schema.md            what a profile is
    agent-api.md                 the local API contract
    relay-protocol.md            phone pairing and signaling (Stage 6)
    profile-file.md              exported profile file: format and rules (Stage 7)
    schemas/profile.schema.json  machine-readable profile schema

  ui/
    design-system.md             look and feel, colors, type, the one signature detail
    screens.md                   every screen, its elements and states
    flows.md                     key user journeys
    copy-guidelines.md           how all text should read (owner's copy rules)

  testing/
    test-plan.md                 standing checks across stages
    fingerprint-checklist.md     per-profile fingerprint verification

  progress/
    PROGRESS.md                  current status (update every session)
    DECISIONS.md                 decision log (append when you choose or deviate)

  images/browser/                the Docker image (neko + Camoufox) - built in Stage 1
  packages/
    shared/                      shared TypeScript types (the contract)
    agent/                       local control service + CLI
    desktop/                     Electron Windows app (Stage 5)
    mobile/                      phone PWA (Stage 2+)
    relay/                       pairing/signaling server (Stage 6)
  scripts/                       PowerShell + bash helpers
  .claude/commands/              /status /next /verify-stage /decision
```

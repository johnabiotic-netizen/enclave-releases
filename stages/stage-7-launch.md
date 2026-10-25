# Stage 7: Launch

**Goal:** turn the tool into something a stranger can buy, install and trust.

**Done when** payment works, the installer is signed, setup is easy, and profiles can be backed up and restored.

## Build tasks

### Easier install
- [ ] Investigate bundling a minimal WSL distro with Docker Engine or Podman so users do not install Docker Desktop manually, and larger companies avoid Docker licensing. Prototype; if too heavy, fall back to a guided Docker Desktop install with the in app setup checker from Stage 5.
- [ ] One installer that leads straight into the setup checker and first run image build.

### Trust
- [ ] Buy a code signing certificate (OV or EV). Sign the installer and app so Windows SmartScreen does not warn. Document the signing process in `scripts/`.
- [ ] `THIRD_PARTY_NOTICES.md` complete and shipped.
- [ ] Privacy policy and terms of service (see `docs/08-legal-and-acceptable-use.md`), including acceptable use and the ability to suspend.

### Backups
- [ ] Encrypted profile backup to object storage (Backblaze B2 or Cloudflare R2). Key derived on the PC; never upload the key. Restore flow on a new PC.
- [ ] Export/import a single profile as an encrypted file.

### Licensing and payments
- [ ] Decide the model: license by number of concurrent running profiles, not stored profiles.
- [ ] Confirm a payment provider accepts the product BEFORE building billing (Paystack, Lemon Squeezy, Paddle, or crypto). Note Stripe does not onboard Nigerian businesses directly.
- [ ] License check tied to the account on the relay; graceful offline grace period.

### Launch
- [ ] Landing page (reuse `ui/design-system.md`), honest marketing per the legal doc.
- [ ] Paid beta with a few agency contacts; collect setup success rate and fix the top failures.

## Acceptance tests
1. A non technical buyer installs the signed app with no security warning and reaches a running profile.
2. A profile backed up on one PC restores correctly on another, fully encrypted in transit and at rest.
3. A payment completes and unlocks the right concurrency tier.
4. Exceeding the tier is handled gracefully with a clear upgrade prompt.

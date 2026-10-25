# Legal, licensing and acceptable use

This is not legal advice. The owner should get proper advice before selling.

## Open source licenses we depend on

| Component | License | What it means for us |
|---|---|---|
| Camoufox | MPL 2.0 | Commercial use allowed. If we modify Camoufox's own source files, we must publish those modified files. Our agent, app and relay can stay closed. |
| neko | Apache 2.0 | Commercial use allowed. Keep license and notice files. |
| Firefox (inside Camoufox) | MPL 2.0 | As above. Do not use the Firefox name or logo in our branding. |
| Docker Desktop | Proprietary, free for personal use and small businesses | Customers at larger companies may need paid Docker subscriptions. Stage 7 aims to remove this dependency. |

Keep a `THIRD_PARTY_NOTICES.md` updated as dependencies are added (create it in Stage 1).

## Acceptable use policy (for the product)

Users may not use the product to:
- commit fraud, impersonate others, or create accounts in another person's identity
- defeat identity verification, KYC or liveness checks
- send spam or run abusive automation
- access accounts they are not authorized to access

The product must have the ability to suspend a license and revoke relay access.

## Product guardrail (also in CLAUDE.md)

Camera and mic passthrough carries the real user's live phone camera and mic. We do not build features designed to defeat identity verification, liveness checks, or detection of virtual cameras or injected streams. We do not market the product as passing ID verification. If a verification flow rejects the passthrough, the user completes it on a real device.

## Marketing language

Say: private profiles, separate environments, continue on your phone, live phone camera.
Do not say: undetectable, bypass verification, unlimited accounts, avoid bans.

## Payments

Antidetect browsers are often classed as high risk by payment processors. Confirm acceptance with the chosen provider (Paystack, Lemon Squeezy, Paddle or others) before building billing. Stripe does not onboard Nigerian businesses directly.

## Privacy

Browsing data stays on the user's PC. The relay stores only account email, device records and pairing data. Write a privacy policy that says exactly this before launch.

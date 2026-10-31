# Security

Profiles hold live logins to email, social and payment accounts. Treat every profile volume like a password vault.

## Threat model (what we defend against)

| Threat | Defense |
|---|---|
| Real IP leaks from a profile | Fail closed egress lock, WebRTC leak protection, DNS through proxy |
| Another program on the PC talks to the agent | Agent binds 127.0.0.1 only, requires bearer token, token stored in OS credential store |
| Someone on the network opens a profile stream | Stage 2: Tailscale only. Stage 6: relay auth plus per session stream tokens. Never publish ports on 0.0.0.0 |
| Relay server breached | Relay stores no browsing data, only pairing records and hashed device keys. Media is DTLS-SRTP encrypted |
| Profiles cross contaminate | One container and one volume per profile, no shared mounts, no shared network between containers |
| Stolen backup files | Backups encrypted on the PC before upload (Stage 7), key never leaves the PC unencrypted |
| Malicious website escapes the browser | Container runs as non root, drop capabilities, read only root filesystem where possible, no Docker socket mounted |

## Egress lock (fail closed)

Every profile container must be unable to reach the internet except through its proxy.

Approach (verify it works with Docker Desktop on WSL 2):
1. Each profile container gets its own Docker network.
2. Inside the container, an entrypoint step applies firewall rules (iptables or nftables) that allow outbound traffic only to the proxy's host and port, plus loopback. Everything else is dropped. Requires `NET_ADMIN` capability only for that setup step if possible; otherwise document why.
3. DNS: the browser resolves through the proxy (SOCKS5 with remote DNS, or HTTP proxy CONNECT). Block port 53 outbound.
4. Test: with the proxy deliberately broken, the browser must fail to load any page, and an IP check must never show the real IP.

Alternative if in-container firewall is not workable: a tiny sidecar container per profile that is the only path out (the profile container has no default route except through it). Record the choice in `progress/DECISIONS.md`.

WebRTC streaming ports for neko are inbound to the container from the viewer, not outbound browsing traffic. Keep those separate and bind them to 127.0.0.1 (Stage 1) or the Tailscale interface (Stage 2).

## WebRTC leak protection inside the browser

The browser inside the profile must not reveal local or real public IPs through WebRTC. Configure Camoufox so WebRTC either is disabled per profile or only exposes the proxy IP. Test on BrowserLeaks WebRTC page.

## Secrets

- Development: `.env` (git ignored). Provide `.env.example` with placeholders only.
- Desktop app: Electron `safeStorage` (DPAPI on Windows) for the agent token (`app-settings.json`) and each profile's passwords (`profiles/<id>/secrets.sealed`: proxy password, stream logins). The app seals any plain `secrets.json` it finds at start and deletes it. DPAPI protects from other Windows users and from copying the files to another PC, not from other programs of the same Windows user.
- `profile.json` stores only a reference to the proxy secret (`secretRef`), never the password.
- The developer CLI's own agent (`enclave serve`) has no safeStorage: it uses a plain git ignored `secrets.json` and refuses a sealed profile (`SECRETS_LOCKED`). CLI commands sent to the app's agent work as usual.

## Container hardening checklist

- [ ] Runs as non root user
- [ ] `--cap-drop ALL`, add back only what neko needs (document each)
- [ ] `--security-opt no-new-privileges`
- [ ] No Docker socket mounted
- [ ] Memory and CPU limits per container
- [ ] `shm_size` set high enough for the browser (at least 2 GB) but limited

## Phone access security

- Stage 2: Tailscale. Stream ports bound to the Tailscale IP or 127.0.0.1 plus `tailscale serve`. neko password per profile, random, 24+ chars.
- Stage 6: see `specs/relay-protocol.md`. Device pairing by QR with a one time code, long lived device keys, short lived session tokens, ability to revoke a device from the PC.

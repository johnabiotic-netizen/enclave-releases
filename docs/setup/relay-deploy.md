# Deploying the Enclave relay

The relay lets a phone reach your PC's profiles from any network, without Tailscale (Stage 6, `specs/relay-protocol.md`). It runs on one small server: the relay itself, Caddy (HTTPS with a free Let's Encrypt certificate) and coturn (TURN, for networks where a direct connection fails), all in Docker. The files are in `deploy/relay/`.

The relay never sees your browsing: everything between the phone and the PC is end-to-end encrypted, and the stream is encrypted by WebRTC. It keeps only accounts, PCs and paired phones.

## What you need
- A server with a public IPv4 address, Ubuntu 24.04, 2 GB of memory or more (for example Hetzner Cloud CX22, about 4 to 5 euros a month).
- A domain with an `A` record for the relay's name (for example `relay.example.com`) pointing at the server. With Cloudflare, set the record to **DNS only** (grey cloud): Cloudflare's proxy doesn't carry TURN.
- On the PC: the SSH key `~/.ssh/enclave_relay` (its public half added to the server when it was created) and Git Bash.

## 1. Set up the server (once)
From the repo root in Git Bash:
```bash
scp -i ~/.ssh/enclave_relay deploy/relay/setup-server.sh root@<server IP>:/root/
ssh -i ~/.ssh/enclave_relay root@<server IP> bash /root/setup-server.sh
```
It updates Ubuntu, installs Docker Engine from Docker's repository (pinned versions, key fingerprint checked), turns on the firewall with only these ports open, and keeps security updates automatic:

| Port | For |
|---|---|
| 22/tcp | SSH |
| 80/tcp, 443/tcp | HTTPS (80 only for the certificate) |
| 3478/udp, 3478/tcp | TURN and STUN |
| 49160-49999/udp | TURN relay ports |

## 2. Deploy
```bash
deploy/relay/deploy.sh <server IP> relay.example.com
```
The first run makes `/opt/enclave-relay/deploy/relay/.env` on the server with a new TURN secret and an invite code (made on the server, printed once). Later runs need only the IP: `deploy/relay/deploy.sh <server IP>`. Only committed code is deployed.

Check it: open `https://relay.example.com/r/v1/info` in a browser. It shows `{"name":"enclave-relay",...}`. The certificate comes within a minute of the first start.

## 3. Sign in from the PC
In the Windows app: **Settings** → **Phone access** → **Through your Enclave relay**. Enter the relay address, your email and a password (10 characters or more), tick **Make a new account with this email**, paste the invite code, and choose **Create account and sign in**. The status shows **Connected**.

Then close sign-ups, so nobody else can make an account on your relay:
```bash
ssh -i ~/.ssh/enclave_relay root@<server IP> "cd /opt/enclave-relay/deploy/relay && sed -i 's/^RELAY_SIGNUP=.*/RELAY_SIGNUP=closed/' .env && docker compose up -d"
```
Another PC signs in to the same account without the checkbox.

## 4. Pair a phone
**Settings** → **Pair a phone** shows a QR code for 2 minutes. Scan it with the phone's camera; the phone opens Enclave in its browser and pairs. Add it to the home screen from the browser's menu (**Install app** or **Add to home screen**). On an iPhone, the home screen app keeps its own storage: pair from Safari after adding it, by scanning a new QR code.

To unpair a phone: **Settings** → **Paired phones** → **Unpair**. It loses access at once.

## Updating
Commit, then `deploy/relay/deploy.sh <server IP>`. Accounts and paired phones are kept (Docker volume `relay-data`). Docker itself is held at its pinned version; to upgrade it, change the versions in `setup-server.sh` and run it again.

## Backups
The relay's data is one small file in the `relay-data` volume. Losing it means signing in again and pairing the phones again; nothing else is lost. To keep a copy:
```bash
ssh -i ~/.ssh/enclave_relay root@<server IP> "docker run --rm -v relay_relay-data:/d alpine:3.22 cat /d/relay.json" > relay-backup.json
```
It holds password hashes and hashed keys only, but keep it private.

## Not yet
- TURN over TLS on port 443, for networks that allow nothing but HTTPS. TURN over TCP 3478 covers networks that only block UDP.
- Push notifications to a closed phone app (needs the owner's approval: it goes through Google or Apple).

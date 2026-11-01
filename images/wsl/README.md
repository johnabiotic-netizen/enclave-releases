# Enclave WSL system

A minimal Debian 13 root file system with Docker Engine 29.9.2 (static build), imported by the
Windows app as the WSL distro `Enclave` on PCs that have no Docker (Stage 7, easier install;
progress/DECISIONS.md). Profiles then run exactly as with Docker Desktop.

- Built on GitHub by the private repo enclave-camoufox, workflow "Enclave WSL", from a copy of
  this folder (`scripts/sync-wsl-ci.sh`). The result, `enclave-wsl.tar.gz`, ships inside the
  installer (`packages/desktop/wsl/`).
- `wsl.conf`: starts Docker at boot (`enclave-boot`), root by default, no Windows drives and no
  Windows programs inside.
- The agent reaches the daemon with `wsl.exe -d Enclave -u root -- socat - UNIX-CONNECT:/var/run/docker.sock`
  (packages/agent/src/docker/connect.ts); nothing listens on a network port.
- All WSL distros share one network. Two Docker engines in WSL at once would fight over the
  same firewall rules, so the app only installs this system when the PC has no Docker of its
  own, and never runs it next to another.
- Licenses: Docker Engine, containerd, runc (Apache 2.0); Debian packages (various; sources at
  https://snapshot.debian.org/). Listed in THIRD_PARTY_NOTICES.md.

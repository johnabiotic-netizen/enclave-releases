#!/bin/bash
# One-time setup of a fresh Ubuntu 24.04 server for the Enclave relay
# (docs/setup/relay-deploy.md). Run as root on the server:
#
#   bash setup-server.sh
#
# Installs Docker Engine from Docker's own apt repository (pinned versions), turns on the
# firewall with only the relay's ports open, and keeps security updates automatic.
set -euo pipefail

DOCKER_VERSION='5:29.9.2-1~ubuntu.24.04~noble'
CONTAINERD_VERSION='2.4.2-3~ubuntu.24.04~noble'
BUILDX_VERSION='0.38.1-1~ubuntu.24.04~noble'
COMPOSE_VERSION='5.6.1-1~ubuntu.24.04~noble'
# Docker's apt signing key (https://download.docker.com/linux/ubuntu/gpg).
DOCKER_KEY_FINGERPRINT='9DC858229FC7DD38854AE2D88D81803C0EBFCD88'

. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ]; then
  echo "This script is for Ubuntu 24.04; this server runs $PRETTY_NAME." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl gnupg ufw unattended-upgrades

# Docker's repository, with its key checked against the published fingerprint.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.asc
got="$(gpg --show-keys --with-colons /tmp/docker.asc | awk -F: '$1 == "fpr" { print $10; exit }')"
if [ "$got" != "$DOCKER_KEY_FINGERPRINT" ]; then
  echo "Docker's signing key has an unexpected fingerprint ($got). Stopping." >&2
  exit 1
fi
mv /tmp/docker.asc /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y \
  "docker-ce=${DOCKER_VERSION}" "docker-ce-cli=${DOCKER_VERSION}" \
  "containerd.io=${CONTAINERD_VERSION}" \
  "docker-buildx-plugin=${BUILDX_VERSION}" "docker-compose-plugin=${COMPOSE_VERSION}"
# Pinned: upgrades of Docker are deliberate, not automatic.
apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Firewall: SSH, HTTPS (and HTTP for the certificate), TURN, and TURN's relay ports.
# Docker publishes 80 and 443 itself; ufw covers the host-network coturn and SSH.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49999/udp
ufw --force enable

# Security updates install themselves (Ubuntu's default, made explicit).
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

install -d -m 0750 /opt/enclave-relay
docker version --format 'Docker {{.Server.Version}} ready.'

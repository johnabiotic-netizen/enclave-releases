#!/bin/bash
# Puts the committed relay (HEAD) on the server and (re)starts it (docs/setup/relay-deploy.md).
# Run from the repo root in Git Bash, after setup-server.sh has run on the server once:
#
#   deploy/relay/deploy.sh <server IPv4> [<relay domain>]
#
# The domain is needed the first time only: it makes the server's .env, with a new TURN secret
# and a one-time invite code made on the server (they never pass through this PC's disk).
# SSH uses ~/.ssh/enclave_relay (override with ENCLAVE_RELAY_KEY).
set -euo pipefail

host="${1:?Usage: deploy/relay/deploy.sh <server IPv4> [<relay domain>]}"
domain="${2:-}"
key="${ENCLAVE_RELAY_KEY:-$HOME/.ssh/enclave_relay}"
ssh_=(ssh -i "$key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "root@$host")
dir=/opt/enclave-relay

if [ -n "$(git status --porcelain -- packages/shared packages/relay packages/mobile deploy/relay)" ]; then
  echo "Commit the relay's changes first: only HEAD is deployed." >&2
  exit 1
fi

echo "Copying $(git rev-parse --short HEAD) to $host:$dir"
git archive --format=tar HEAD \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .dockerignore \
  packages/shared packages/relay packages/mobile deploy/relay |
  "${ssh_[@]}" "install -d -m 0750 $dir && rm -rf $dir/packages && find $dir/deploy -mindepth 2 -type f ! -name .env -delete 2>/dev/null; tar -x -C $dir"
# The server's .env (its secrets) lives only there: the copy above never removes or replaces it.

if [ -n "$domain" ]; then
  "${ssh_[@]}" "domain='$domain' bash -s" <<'EOF'
set -euo pipefail
cd /opt/enclave-relay/deploy/relay
if [ -f .env ]; then echo ".env already exists; left as it is."; exit 0; fi
ip="$(ip -4 route get 1.1.1.1 | awk '{ for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1) }')"
invite="$(openssl rand -hex 12)"
umask 077
cat > .env <<ENV
RELAY_DOMAIN=$domain
TURN_IP=$ip
TURN_SECRET=$(openssl rand -base64 33 | tr -d '\n')
RELAY_SIGNUP=invite
RELAY_INVITE_CODE=$invite
ENV
echo "Made .env for $domain at $ip. One-time invite code for the first account: $invite"
EOF
fi

"${ssh_[@]}" "cd $dir/deploy/relay && { test -f .env || { echo 'No .env on the server: run once with the domain.' >&2; exit 1; }; } && docker compose up -d --build --remove-orphans && docker image prune -f >/dev/null && docker compose ps"

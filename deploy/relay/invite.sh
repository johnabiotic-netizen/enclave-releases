#!/bin/bash
# A single-use invite code for one beta tester's account, made on the relay server.
# Run from the repo root in Git Bash:
#
#   deploy/relay/invite.sh <server IPv4> "<who it is for>"     prints the code
#   deploy/relay/invite.sh <server IPv4> --list                the invites, used or not
#
# Needs RELAY_SIGNUP=invite in the server's .env. SSH uses ~/.ssh/enclave_relay.
set -euo pipefail

host="${1:?Usage: deploy/relay/invite.sh <server IPv4> \"<who it is for>\" | --list}"
what="${2:?Say who the invite is for, or --list}"
key="${ENCLAVE_RELAY_KEY:-$HOME/.ssh/enclave_relay}"
ssh_=(ssh -i "$key" -o IdentitiesOnly=yes "root@$host")
dir=/opt/enclave-relay/deploy/relay

if [ "$what" = "--list" ]; then
  "${ssh_[@]}" "cd $dir && docker compose exec -T relay node /app/relay.mjs invites"
else
  # The note travels as one quoted argument; quotes inside it are dropped.
  note="${what//[\"\'\`\$\\]/}"
  "${ssh_[@]}" "cd $dir && docker compose exec -T relay node /app/relay.mjs invite \"$note\""
fi

#!/bin/bash
set -euo pipefail

ip="$1"
port="$2"
turn="${3:-}"
uid="$(id -u egress)"

DOCKER_DNS=127.0.0.11

iptables -w -F OUTPUT
iptables -w -A OUTPUT -d "$DOCKER_DNS" -j REJECT
iptables -w -A OUTPUT -o lo -j ACCEPT
iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -w -A OUTPUT -p tcp -d "$ip" --dport "$port" -m owner --uid-owner "$uid" -j ACCEPT
if [ -n "$turn" ]; then
  if ! [[ "$turn" =~ ^([0-9]{1,3}(\.[0-9]{1,3}){3}):([0-9]{1,5})$ ]]; then
    echo "net_apply: bad TURN address \"$turn\"" >&2
    exit 1
  fi
  gid="$(getent group stream | cut -d: -f3)"
  iptables -w -A OUTPUT -p udp -m owner --gid-owner "$gid" -j ACCEPT
  iptables -w -A OUTPUT -p tcp -d "${BASH_REMATCH[1]}" --dport "${BASH_REMATCH[3]}" -m owner --gid-owner "$gid" -j ACCEPT
fi
iptables -w -A OUTPUT -j REJECT
iptables -w -P OUTPUT DROP

if [ -e /proc/net/if_inet6 ]; then
  ip6tables -w -F OUTPUT
  ip6tables -w -A OUTPUT -o lo -j ACCEPT
  ip6tables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -w -A OUTPUT -j REJECT
  ip6tables -w -P OUTPUT DROP
fi

iptables -w -S OUTPUT | grep -qx -- '-P OUTPUT DROP'
iptables -w -S OUTPUT | tail -n 1 | grep -q -- '^-A OUTPUT -j REJECT'

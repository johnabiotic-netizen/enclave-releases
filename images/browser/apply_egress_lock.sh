#!/bin/bash
# Egress lock (docs/04-security.md): after this, the only connection that can leave the
# container is the egress user's (the gost forwarder) to the profile's proxy. Everything
# else is refused, DNS included. Run by entrypoint.sh as root, before any other program.
#
#   apply_egress_lock.sh <proxy IPv4> <proxy port>
#
# Inbound connections (the viewer's stream) still work: their replies are ESTABLISHED.
set -euo pipefail

ip="$1"
port="$2"
uid="$(id -u egress)"

# Docker's embedded DNS listens on 127.0.0.11 and forwards queries from the host, outside
# the proxy. Refuse it before the general loopback rule.
DOCKER_DNS=127.0.0.11

iptables -w -F OUTPUT
iptables -w -A OUTPUT -d "$DOCKER_DNS" -j REJECT
iptables -w -A OUTPUT -o lo -j ACCEPT
iptables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -w -A OUTPUT -p tcp -d "$ip" --dport "$port" -m owner --uid-owner "$uid" -j ACCEPT
iptables -w -A OUTPUT -j REJECT
iptables -w -P OUTPUT DROP

# IPv6: nothing leaves at all (the proxy is reached over IPv4).
if [ -e /proc/net/if_inet6 ]; then
  ip6tables -w -F OUTPUT
  ip6tables -w -A OUTPUT -o lo -j ACCEPT
  ip6tables -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -w -A OUTPUT -j REJECT
  ip6tables -w -P OUTPUT DROP
fi

# Refuse to continue unless the lock is really in place.
iptables -w -S OUTPUT | grep -qx -- '-P OUTPUT DROP'
iptables -w -S OUTPUT | tail -n 1 | grep -q -- '^-A OUTPUT -j REJECT'

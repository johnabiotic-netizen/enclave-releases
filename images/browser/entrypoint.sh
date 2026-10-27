#!/bin/bash
# Runs as root before anything else. With arguments it just runs them (used for one-off
# commands such as gen_fingerprint.py). Without, it prepares the profile and starts neko.
set -euo pipefail

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

for f in /config/profile.json /config/proxy.json; do
  if [ ! -r "$f" ]; then
    echo "enclave: $f is missing. The agent mounts it when it starts a profile." >&2
    exit 1
  fi
done

# 0711: every user can open a file it knows the name of (openbox, running as neko, reads
# openbox.xml) but not list the folder; gost.yaml itself is readable by egress only.
install -d -m 0711 -o root -g egress /run/enclave
/opt/enclave/prepare_profile.py
# The forwarder config holds the proxy password: readable by the egress user only.
chown egress:egress /run/enclave/gost.yaml
chmod 0400 /run/enclave/gost.yaml
chmod 0644 /run/enclave/openbox.xml

# Fail closed: no lock, no browser. Needs the NET_ADMIN capability (docker run --cap-add).
. /run/enclave/egress.env
if ! /opt/enclave/apply_egress_lock.sh "$PROXY_IP" "$PROXY_PORT"; then
  echo "enclave: cannot apply the network lock, so the browser will not start. The container needs --cap-add NET_ADMIN." >&2
  exit 1
fi

install -d -m 0700 -o neko -g neko /data/profile /data/downloads

# Screen size from the saved fingerprint (supervisord passes its environment to neko).
set -a
. /run/enclave/neko.env
set +a

# Drop NET_ADMIN (and raw sockets) for good before anything else runs, so no process in
# the container, root included, can change or remove the lock.
exec capsh --drop=cap_net_admin,cap_net_raw -- -c 'exec /usr/bin/supervisord -c /etc/neko/supervisord.conf'

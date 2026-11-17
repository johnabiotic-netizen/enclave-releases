#!/bin/bash
set -euo pipefail

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

for f in /config/profile.json /config/proxy.json; do
  if [ ! -r "$f" ]; then
    echo "session: $f is missing. The agent mounts it when it starts a profile." >&2
    exit 1
  fi
done

install -d -m 0711 -o root -g egress /run/session
/opt/session/profile_apply.py
chown egress:egress /run/session/gost.yaml
chmod 0400 /run/session/gost.yaml
chmod 0644 /run/session/openbox.xml

. /run/session/egress.env
if ! /opt/session/net_apply.sh "$PROXY_IP" "$PROXY_PORT" "${SESSION_TURN:-}"; then
  echo "session: cannot apply the network lock, so the browser will not start. The container needs --cap-add NET_ADMIN." >&2
  exit 1
fi

install -d -m 0700 -o neko -g neko /data/profile /data/downloads

set -a
. /run/session/neko.env
set +a

exec capsh --drop=cap_net_admin,cap_net_raw -- -c 'exec /usr/bin/supervisord -c /etc/neko/supervisord.conf'

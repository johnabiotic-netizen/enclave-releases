#!/bin/bash
# Test-only: watch a running profile while someone tests the phone camera: camera frames
# (container/camera-monitor.py) and, from the container's network namespace, the phone's
# WebRTC TCP socket (queues, round trip, retransmits) once a second.
# Run where docker runs (on the owner's PC: inside WSL as root):
#   scripts/phone/monitor.sh <profile id> [seconds]      socket lines go to ./tcp-<id>.log
set -euo pipefail
id=$1; secs=${2:-900}
c=enclave-$id
here=$(cd "$(dirname "$0")" && pwd)
mux=$(docker port "$c" | sed -n 's|^\([0-9]*\)/tcp.*|\1|p' | grep -v '^8080$' | head -1)
pid=$(docker inspect -f '{{.State.Pid}}' "$c")
docker cp "$here/container/camera-monitor.py" "$c:/tmp/camera-monitor.py" >/dev/null
( end=$((SECONDS + secs)); while [ $SECONDS -lt $end ]; do
    out=$(nsenter -t "$pid" -n ss -tniH state established "( sport = :$mux )" | tr -s ' \n' ' ' |
      grep -oE '^ ?[0-9]+ [0-9]+|rtt:[0-9.]+|retrans:[0-9/]+|unacked:[0-9]+|notsent:[0-9]+|bytes_sent:[0-9]+|bytes_received:[0-9]+' | tr '\n' ' ' || true)
    [ -n "$out" ] && echo "$(date -u +%T) UTC  tcp $out"
    sleep 1
  done ) > "tcp-$id.log" 2>&1 &
docker exec "$c" python3 -u /tmp/camera-monitor.py "$secs"
wait

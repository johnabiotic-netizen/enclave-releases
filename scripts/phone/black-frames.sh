#!/bin/bash
# Test-only: does the browser ever show a black frame between two good camera frames?
# container/slow-writer.py writes frames slowly (each write 4 ms) while pages/black-frames.html
# counts black frames for 40 s. Expected: "black": 0. With --stopped no frames are written,
# and every frame must be black (a stopped camera does not freeze on an old picture).
# Use a THROWAWAY profile (create one with --test-proxy): this turns off the browser's
# camera permission prompt in it. Run where docker runs (owner's PC: inside WSL as root):
#   scripts/phone/black-frames.sh <throwaway profile id> [--stopped]
set -euo pipefail
id=$1; mode=${2:-}
c=enclave-$id
here=$(cd "$(dirname "$0")" && pwd)
docker cp "$here/pages/black-frames.html" "$c:/data/black-frames.html"
docker exec "$c" sh -c 'chmod 644 /data/black-frames.html; rm -f /data/downloads/black-frames-result*.json'
docker exec "$c" supervisorctl stop camoufox >/dev/null
docker exec -u neko "$c" sh -c 'grep -q media.navigator.permission.disabled /data/profile/prefs.js || echo "user_pref(\"media.navigator.permission.disabled\", true);" >> /data/profile/prefs.js'
docker exec "$c" supervisorctl start camoufox >/dev/null
docker exec "$c" supervisorctl stop camfeed >/dev/null
if [ "$mode" != "--stopped" ]; then
  docker cp "$here/container/slow-writer.py" "$c:/tmp/slow-writer.py"
  docker exec -d -u neko "$c" python3 /tmp/slow-writer.py
fi
sleep 6
docker exec -u neko -e DISPLAY=:99.0 "$c" sh -c "xdotool key ctrl+l; sleep 0.5; xdotool type --delay 30 'file:///data/black-frames.html'; sleep 0.3; xdotool key Return"
for _ in $(seq 1 40); do
  sleep 2
  docker exec "$c" sh -c 'ls /data/downloads/black-frames-result*.json' >/dev/null 2>&1 && break
done
docker exec "$c" sh -c 'cat /data/downloads/black-frames-result*.json'
sleep 5
docker exec "$c" supervisorctl start camfeed >/dev/null

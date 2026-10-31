#!/bin/bash
# Test-only: put one of pages/ into a running profile as /data/<page> and open it there.
# --no-prompt also turns off the camera and mic permission prompt (THROWAWAY profiles only),
# for pages a script reads (media-test.html writes its result to /data/downloads).
# Run where docker runs (owner's PC: inside WSL as root):
#   scripts/phone/open-page.sh <profile id> <page file name> [--no-prompt]
set -euo pipefail
id=$1; page=$2; mode=${3:-}
c=enclave-$id
here=$(cd "$(dirname "$0")" && pwd)
docker cp "$here/pages/$page" "$c:/data/$page"
docker exec "$c" chmod 644 "/data/$page"
if [ "$mode" = "--no-prompt" ]; then
  docker exec "$c" supervisorctl stop camoufox >/dev/null
  docker exec -u neko "$c" sh -c 'grep -q media.navigator.permission.disabled /data/profile/prefs.js || echo "user_pref(\"media.navigator.permission.disabled\", true);" >> /data/profile/prefs.js'
  docker exec "$c" supervisorctl start camoufox >/dev/null
  sleep 6
fi
docker exec -u neko -e DISPLAY=:99.0 "$c" sh -c "xdotool key ctrl+l; sleep 0.5; xdotool type --delay 30 'file:///data/$page'; sleep 0.3; xdotool key Return"
echo "Opened file:///data/$page in $c"

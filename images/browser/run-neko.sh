#!/bin/bash
# Starts neko (supervisord runs this as root) as the neko user with its own primary group,
# "stream". The egress lock (apply_egress_lock.sh) lets that group, and so neko alone, send
# the phone stream when the PC is linked through the Enclave relay. The browser runs as neko
# with group neko and never gets it. neko keeps its usual supplementary groups (audio, video,
# pulse, neko) and no capabilities.
set -euo pipefail
groups="$(id -G neko | tr ' ' ',')"
exec setpriv --reuid=neko --regid=stream --groups="$groups" --inh-caps=-all -- /usr/bin/neko "$@"

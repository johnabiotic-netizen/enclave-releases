#!/bin/bash
set -euo pipefail
groups="$(id -G neko | tr ' ' ',')"
exec setpriv --reuid=neko --regid=stream --groups="$groups" --inh-caps=-all -- /usr/bin/neko "$@"

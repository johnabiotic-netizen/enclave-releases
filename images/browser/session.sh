#!/bin/bash
set -euo pipefail
if [ "${SESSION_DIAG:-}" = "1" ]; then
  exec /opt/session/diag.py
fi
exec /opt/session/launch.py

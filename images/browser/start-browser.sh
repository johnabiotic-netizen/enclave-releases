#!/bin/bash
# supervisord program: starts Camoufox as the neko user with the profile's saved fingerprint.
# In an audit container (ENCLAVE_AUDIT=1) the same browser is started by audit.py, which
# runs the check pages and records what they report (testing/test-suite.md).
set -euo pipefail
if [ "${ENCLAVE_AUDIT:-}" = "1" ]; then
  exec /opt/enclave/audit.py
fi
exec /opt/enclave/launch_browser.py

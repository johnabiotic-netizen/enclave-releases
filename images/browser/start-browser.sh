#!/bin/bash
# supervisord program: starts Camoufox as the neko user with the profile's saved fingerprint.
set -euo pipefail
exec /opt/enclave/launch_browser.py

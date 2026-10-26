#!/opt/enclave/venv/bin/python
"""Start Camoufox for this profile.

Everything that identifies the browser comes from the fingerprint saved in
/config/profile.json (fingerprint.raw). Nothing is generated here: a profile looks
the same on every launch (docs/05-fingerprints.md).
"""

import json
import os
import sys

# The camoufox package finds its install through XDG_CACHE_HOME. The browser itself
# must not inherit that (read-only) path, so the original value is restored for it.
BROWSER_XDG_CACHE_HOME = os.environ.get("XDG_CACHE_HOME")
os.environ["XDG_CACHE_HOME"] = os.environ.get("ENCLAVE_CAMOUFOX_CACHE", "/opt/camoufox-cache")

from camoufox.pkgman import camoufox_path  # noqa: E402
from camoufox.utils import get_env_vars, get_pref_env_vars  # noqa: E402

PROFILE_JSON = "/config/profile.json"
PROFILE_DIR = "/data/profile"

# Applied on top of the saved prefs on every launch. They control where traffic goes,
# not how the browser looks, so they are not part of the fingerprint.
RUNTIME_PREFS = {
    # All traffic through the local forwarder (write_proxy_config.py), DNS included.
    "network.proxy.type": 1,
    "network.proxy.socks": "127.0.0.1",
    "network.proxy.socks_port": 1080,
    "network.proxy.socks_version": 5,
    "network.proxy.socks_remote_dns": True,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": True,
    "network.proxy.failover_direct": False,
    "network.trr.mode": 5,
    "network.dns.disablePrefetch": True,
    "network.prefetch-next": False,
    # Reopen the previous tabs after a restart.
    "browser.startup.page": 3,
    "browser.sessionstore.resume_from_crash": True,
    # The image is pinned; the browser must not update itself.
    "app.update.enabled": False,
}


def main() -> None:
    with open(PROFILE_JSON, encoding="utf-8") as f:
        profile = json.load(f)

    raw = (profile.get("fingerprint") or {}).get("raw") or {}
    config = raw.get("config")
    if not config:
        sys.exit("enclave: profile.json has no saved fingerprint (fingerprint.raw.config); not starting")

    env = dict(os.environ)
    env.pop("XDG_CACHE_HOME")
    if BROWSER_XDG_CACHE_HOME:
        env["XDG_CACHE_HOME"] = BROWSER_XDG_CACHE_HOME
    env.update({k: str(v) for k, v in get_env_vars(config, "win").items()})
    env.update(get_pref_env_vars({**raw.get("prefs", {}), **RUNTIME_PREFS}))

    binary = str(camoufox_path(download_if_missing=False) / "camoufox-bin")
    os.makedirs(PROFILE_DIR, exist_ok=True)
    os.execve(binary, [binary, "--no-remote", "--profile", PROFILE_DIR], env)


if __name__ == "__main__":
    main()

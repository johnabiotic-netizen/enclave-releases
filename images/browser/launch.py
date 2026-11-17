#!/opt/session/venv/bin/python

import json
import os
import sys

BROWSER_XDG_CACHE_HOME = os.environ.get("XDG_CACHE_HOME")
os.environ["XDG_CACHE_HOME"] = os.environ.get("SESSION_CACHE", "/opt/session-cache")

from camoufox.gpudisplay import GPU_PREFS  # noqa: E402
from camoufox.pkgman import camoufox_path  # noqa: E402
from camoufox.utils import get_env_vars, get_pref_env_vars  # noqa: E402

PROFILE_JSON = "/config/profile.json"
PROFILE_DIR = "/data/profile"

RUNTIME_PREFS = {
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
    "browser.startup.page": 3,
    "browser.sessionstore.resume_from_crash": True,
    "app.update.enabled": False,
    "browser.download.folderList": 2,
    "browser.download.dir": "/data/downloads",
    "security.sandbox.content.read_path_whitelist": "/dev/shm/enclave-camera",
}
DOWNLOADS_DIR = "/data/downloads"
GL_SHIM = "/opt/session/libglcompat.so"

USER_PREFS = {
    "browser.contentblocking.category": "strict",
}

GPU = os.environ.get("SESSION_ACCEL") == "1"

WINDOWS_DEFAULT_PREFS = {
    "font.name-list.emoji": "Segoe UI Emoji, Twemoji Mozilla",
    "permissions.default.geo": 0,
    "gfx.bundled-fonts.activate": 0,
}

def prepare_launch() -> tuple[str, dict]:
    """The browser binary and its environment for this profile, with the profile
    directory and user.js in place. Shared by the normal start (main) and the audit
    (diag.py), so an audit measures what a normal start shows."""
    with open(PROFILE_JSON, encoding="utf-8") as f:
        profile = json.load(f)

    raw = (profile.get("fingerprint") or {}).get("raw") or {}
    config = raw.get("config")
    if not config:
        sys.exit("session: profile.json has no saved fingerprint (fingerprint.raw.config); not starting")

    exit_ip = os.environ.get("SESSION_GEO_IP")
    if exit_ip and "webrtc:ipv4" in config:
        config = {**config, "webrtc:ipv4": exit_ip}
    lat, lon = os.environ.get("SESSION_GEO_LAT"), os.environ.get("SESSION_GEO_LON")
    if lat and lon and "geolocation:latitude" in config:
        config = {**config, "geolocation:latitude": float(lat), "geolocation:longitude": float(lon)}

    env = dict(os.environ)
    env.pop("XDG_CACHE_HOME")
    if BROWSER_XDG_CACHE_HOME:
        env["XDG_CACHE_HOME"] = BROWSER_XDG_CACHE_HOME
    env.update({k: str(v) for k, v in get_env_vars(config, "win").items()})
    gpu_prefs = GPU_PREFS if GPU else {}
    env.update(
        get_pref_env_vars({**raw.get("prefs", {}), **WINDOWS_DEFAULT_PREFS, **gpu_prefs, **RUNTIME_PREFS})
    )

    env["LD_PRELOAD"] = GL_SHIM
    env["ENCLAVE_FONT_METRICS"] = "dwrite"
    env["ENCLAVE_PHONE_MEDIA"] = "1"
    binary = str(camoufox_path(download_if_missing=False) / "camoufox-bin")
    os.makedirs(PROFILE_DIR, exist_ok=True)
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    with open(os.path.join(PROFILE_DIR, "user.js"), "w", encoding="utf-8") as f:
        for name, value in USER_PREFS.items():
            f.write(f"user_pref({json.dumps(name)}, {json.dumps(value)});\n")
    return binary, env

def main() -> None:
    binary, env = prepare_launch()
    os.execve(binary, [binary, "--no-remote", "--profile", PROFILE_DIR], env)

if __name__ == "__main__":
    main()

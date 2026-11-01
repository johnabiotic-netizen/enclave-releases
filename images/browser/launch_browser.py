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

from camoufox.gpudisplay import GPU_PREFS  # noqa: E402
from camoufox.pkgman import camoufox_path  # noqa: E402
from camoufox.utils import get_env_vars, get_pref_env_vars  # noqa: E402

PROFILE_JSON = "/config/profile.json"
PROFILE_DIR = "/data/profile"

# Applied on top of the saved prefs on every launch. They control where traffic goes,
# not how the browser looks, so they are not part of the fingerprint.
RUNTIME_PREFS = {
    # All traffic through the local forwarder (gost, see prepare_profile.py), DNS included.
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
    # Downloads go to the profile's volume, so they survive the container being recreated.
    "browser.download.folderList": 2,
    "browser.download.dir": "/data/downloads",
    # The phone camera (zz-enclave-phone-media.patch) is read in the page's own content
    # process, which the sandbox keeps from opening files: websites got a black camera
    # (local test pages worked, their process may read files). Exactly this one file is
    # opened up, read only; it holds the phone camera's latest frame (camfeed.py).
    "security.sandbox.content.read_path_whitelist": "/dev/shm/enclave-camera",
}
DOWNLOADS_DIR = "/data/downloads"
GL_SHIM = "/opt/enclave/libenclave_gl.so"

# Every profile behaves as Firefox with Enhanced Tracking Protection set to Strict
# (DECISIONS.md). Firefox applies the category's settings itself at startup
# (ContentBlockingPrefs.updateCBCategory), including fingerprinting protection, whose
# canvas randomization keeps profiles from sharing a canvas. It only does so for a
# category the user chose, so this goes into user.js as a user value: as a default
# (CAMOU_PREFS) Firefox resets it to "standard".
USER_PREFS = {
    "browser.contentblocking.category": "strict",
}

# Set by the agent when the container has the PC's GPU (/dev/dxg, WSL's D3D12 driver).
GPU = os.environ.get("ENCLAVE_GPU") == "1"

# Where Camoufox (a Linux build) keeps a Linux default that a page can see, Windows
# Firefox's own default instead (modules/libpref/init/all.js, XP_WIN). Applied over the
# saved prefs on every launch, so existing profiles get them without a new fingerprint.
WINDOWS_DEFAULT_PREFS = {
    # Emoji drawn with Segoe UI Emoji, as on Windows 10/11 (Linux: Noto Color Emoji first).
    "font.name-list.emoji": "Segoe UI Emoji, Twemoji Mozilla",
    # Ask before sharing the location, as stock Firefox does. Camoufox grants it to every
    # site (1); permissions.query() then reports "granted" on a fresh profile.
    "permissions.default.geo": 0,
    # Fonts only from Camoufox's fontconfig file, which lists the Windows font groups.
    # With bundled fonts on (Camoufox turns them on when the claimed OS is not the
    # host's), Firefox on Linux also adds the whole fonts/ folder, macOS groups
    # included: Verdana was then drawn from the macOS file, whose GPOS has no
    # features, so its kerning differed from Windows by 1/60 px (measured 2026-10-30).
    # Read at startup, which CAMOU_PREFS (camoufox.cfg) is in time for.
    "gfx.bundled-fonts.activate": 0,
}


def prepare_launch() -> tuple[str, dict]:
    """The browser binary and its environment for this profile, with the profile
    directory and user.js in place. Shared by the normal start (main) and the audit
    (audit.py), so an audit measures what a normal start shows."""
    with open(PROFILE_JSON, encoding="utf-8") as f:
        profile = json.load(f)

    raw = (profile.get("fingerprint") or {}).get("raw") or {}
    config = raw.get("config")
    if not config:
        sys.exit("enclave: profile.json has no saved fingerprint (fingerprint.raw.config); not starting")

    # WebRTC must report the IP websites see now (the agent's check before this start),
    # not the one saved at creation. Only where the fingerprint has WebRTC on.
    exit_ip = os.environ.get("ENCLAVE_EXIT_IP")
    if exit_ip and "webrtc:ipv4" in config:
        config = {**config, "webrtc:ipv4": exit_ip}
    # Same for the location the browser reports: where that IP is now.
    lat, lon = os.environ.get("ENCLAVE_EXIT_LAT"), os.environ.get("ENCLAVE_EXIT_LON")
    if lat and lon and "geolocation:latitude" in config:
        config = {**config, "geolocation:latitude": float(lat), "geolocation:longitude": float(lon)}

    env = dict(os.environ)
    env.pop("XDG_CACHE_HOME")
    if BROWSER_XDG_CACHE_HOME:
        env["XDG_CACHE_HOME"] = BROWSER_XDG_CACHE_HOME
    env.update({k: str(v) for k, v in get_env_vars(config, "win").items()})
    # Render on the GPU (Camoufox's settings for a real GPU display). Without it Firefox
    # falls back to Mesa's software rasterizer, whose output no Windows PC produces.
    gpu_prefs = GPU_PREFS if GPU else {}
    env.update(
        get_pref_env_vars({**raw.get("prefs", {}), **WINDOWS_DEFAULT_PREFS, **gpu_prefs, **RUNTIME_PREFS})
    )

    # Answers the GL driver's initial stencil masks as Windows' ANGLE does (gl_shim.c).
    env["LD_PRELOAD"] = GL_SHIM
    # Text measured with Windows Firefox's DirectWrite numbers (enclave-camoufox's
    # enclave-windows-font-metrics.patch; an unpatched Camoufox ignores it).
    env["ENCLAVE_FONT_METRICS"] = "dwrite"
    # The profile's microphone hears the phone's (enclave-camoufox's
    # zz-enclave-phone-media.patch; neko plays the phone mic into the default input).
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

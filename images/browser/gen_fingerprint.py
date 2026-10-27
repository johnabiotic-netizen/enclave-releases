#!/opt/enclave/venv/bin/python
"""Print a new, complete fingerprint for one profile as JSON on stdout.

Run once, at profile creation (docs/05-fingerprints.md). The agent saves the output
as `fingerprint` in profile.json; launch_browser.py replays `raw` on every launch.

Run with no network (docker run --network none): nothing here needs it, and the
real IP of the PC must never be looked up. --ip is resolved with the GeoIP
database bundled in the image.

  gen_fingerprint.py --gpu "Intel(R) HD Graphics 620" --country US \
      --timezone America/New_York --locale en-US --ip 198.51.100.10

--gpu is the PC's real graphics card as Windows names it. Profiles render on it, so
they claim it, as Windows Firefox reports it (windows_gpu.py).
"""

import argparse
import json
import os
import random
import sys
from importlib.metadata import version

os.environ.setdefault("XDG_CACHE_HOME", os.environ.get("ENCLAVE_CAMOUFOX_CACHE", "/opt/camoufox-cache"))

from camoufox.fingerprints import Screen, _load_media_devices  # noqa: E402
from camoufox.geolocation import get_geolocation  # noqa: E402
from camoufox.pkgman import camoufox_path  # noqa: E402
from camoufox.utils import launch_options  # noqa: E402
from windows_gpu import windows_webgl_pair  # noqa: E402

# Common Windows desktop sizes at 100% scaling, weighted by how often they occur, up to
# 1920x1080 so streaming stays light. Each needs a mode in the image's Xorg config.
SCREENS = [
    ((1920, 1080), 50),
    ((1366, 768), 20),
    ((1600, 900), 12),
    ((1440, 900), 10),
    ((1680, 1050), 8),
]


# The taskbar height Firefox's Strict fingerprinting protection assumes on Windows.
WINDOWS_STRICT_TASKBAR = 48


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--os", default="windows", choices=["windows"])
    p.add_argument("--gpu", required=True, help="the PC's graphics card as Windows names it")
    p.add_argument("--country", required=True, help="ISO 3166-1 alpha-2 country of the proxy exit IP")
    p.add_argument("--timezone", required=True, help="IANA timezone of the proxy exit IP")
    p.add_argument("--locale", required=True, help="BCP 47 locale, e.g. en-US")
    p.add_argument(
        "--ip",
        help="proxy exit IP: sets geolocation and the IP WebRTC shows. Without it, WebRTC is disabled.",
    )
    p.add_argument("--screen", help="WxH from the supported list; default: a weighted random pick")
    return p.parse_args()


def pick_screen(arg: str | None) -> tuple[int, int]:
    sizes = [size for size, _ in SCREENS]
    if arg:
        size = tuple(int(n) for n in arg.lower().split("x"))
        if size not in sizes:
            raise ValueError(f"screen {arg} is not supported; use one of {', '.join(f'{w}x{h}' for w, h in sizes)}")
        return size  # type: ignore[return-value]
    return random.SystemRandom().choices(sizes, weights=[w for _, w in SCREENS])[0]


def decode_chunks(env: dict, prefix: str) -> dict:
    chunks = sorted((int(k.rsplit("_", 1)[1]), v) for k, v in env.items() if k.startswith(prefix))
    return json.loads("".join(v for _, v in chunks)) if chunks else {}


def maximize_window(config: dict) -> None:
    """The browser window is maximized above the taskbar (openbox does this with the
    margins prepare_profile.py derives from the window size), so report that geometry."""
    config["window.screenX"] = 0
    config["window.screenY"] = 0
    config["window.outerWidth"] = config["screen.availWidth"]
    config["window.outerHeight"] = config["screen.availHeight"]
    # Inner size follows from the real window and toolbars; never claim a fixed one.
    config.pop("window.innerWidth", None)
    config.pop("window.innerHeight", None)


def strict_screen(config: dict) -> None:
    """The available area as Firefox with Strict tracking protection reports it on Windows:
    fingerprinting protection's ScreenAvailToResolution makes it the screen minus a 48 px
    taskbar at the bottom (nsRFPService::GetSpoofedScreenAvailSize), whatever the real
    desktop has. The browser computes this itself; the fingerprint stores the same values so
    the window (maximize_window) and the record agree with what pages see."""
    config["screen.availWidth"] = config["screen.width"]
    config["screen.availHeight"] = config["screen.height"] - WINDOWS_STRICT_TASKBAR
    config["screen.availLeft"] = 0
    config["screen.availTop"] = 0


def ensure_webcam(config: dict) -> None:
    """Give the machine a built-in camera when Camoufox drew none.

    Camera passthrough (Stage 4) needs a camera in the device list, and adding one to a
    profile later would change its fingerprint. The label comes from Camoufox's own
    Windows catalogue, weighted as Camoufox weights it; the IR camera is left out (it is
    the Windows Hello sensor, not the one a site would use).
    """
    if config.get("mediaDevices:webcams"):
        return
    cams = [c for c in _load_media_devices()["win"]["cameras"] if not c.get("mic") and "IR" not in c["cam"]]
    cam = random.choices(cams, weights=[c["w"] for c in cams])[0]["cam"]
    groups = config.get("mediaDevices:microphoneGroups", []) + config.get("mediaDevices:speakerGroups", [])
    config["mediaDevices:webcams"] = 1
    config["mediaDevices:webcamLabels"] = [cam]
    config["mediaDevices:webcamGroups"] = [f"hw-{max((int(g[3:]) for g in groups), default=0) + 1}"]


def summarize(args: argparse.Namespace, config: dict, prefs: dict) -> dict:
    """The readable fields of the profile schema, all taken from the generated config."""
    language = args.locale.split("-")[0]
    fingerprint = {
        "os": args.os,
        "camoufoxVersion": camoufox_path(download_if_missing=False).name,
        "generatorVersion": version("camoufox"),
        "userAgent": config["navigator.userAgent"],
        "screen": {
            "width": config["screen.width"],
            "height": config["screen.height"],
            "availHeight": config["screen.availHeight"],
            "colorDepth": config.get("screen.colorDepth", 24),
            "devicePixelRatio": config.get("window.devicePixelRatio", 1),
        },
        "hardware": {"cores": config["navigator.hardwareConcurrency"]},
        "webgl": {
            "vendor": config["webGl:vendor"],
            "renderer": config["webGl:renderer"],
            # The card the profile really renders on; it must stay the same.
            "hostAdapter": args.gpu,
        },
        "audioSeed": format(config["audio:seed"], "08x"),
        "fonts": config.get("fonts", []),
        "locale": args.locale,
        "languages": [args.locale] if language == args.locale else [args.locale, language],
        "timezone": config["timezone"],
        "mediaDevices": (
            [{"kind": "videoinput", "label": x} for x in config.get("mediaDevices:webcamLabels", [])]
            + [{"kind": "audioinput", "label": x} for x in config.get("mediaDevices:microphoneLabels", [])]
            + [{"kind": "audiooutput", "label": x} for x in config.get("mediaDevices:speakerLabels", [])]
        ),
        "webrtc": "proxy-only" if config.get("webrtc:ipv4") else "disabled",
        "raw": {"config": config, "prefs": prefs},
    }
    if "geolocation:latitude" in config:
        fingerprint["geolocation"] = {
            "lat": config["geolocation:latitude"],
            "lon": config["geolocation:longitude"],
        }
    return fingerprint


def validate(args: argparse.Namespace, fp: dict, screen: tuple[int, int], gpu: tuple[str, str]) -> None:
    problems = []
    if "Windows" not in fp["userAgent"]:
        problems.append(f"user agent is not Windows: {fp['userAgent']}")
    if (fp["screen"]["width"], fp["screen"]["height"]) != screen:
        problems.append(f"screen is {fp['screen']['width']}x{fp['screen']['height']}, wanted {screen[0]}x{screen[1]}")
    if (fp["webgl"]["vendor"], fp["webgl"]["renderer"]) != gpu:
        problems.append(f"GPU is {fp['webgl']['renderer']}, wanted {gpu[1]}")
    if fp["timezone"] != args.timezone:
        problems.append(f"timezone is {fp['timezone']}, expected {args.timezone}")
    if not fp["fonts"]:
        problems.append("no fonts")
    if problems:
        raise ValueError("; ".join(problems))


def main() -> None:
    args = parse_args()
    screen = pick_screen(args.screen)
    gpu = windows_webgl_pair(args.gpu)

    if args.ip:
        # Location must match the proxy (hard rule 3): refuse rather than mix countries.
        country = get_geolocation(args.ip).locale.region
        if not country or country.upper() != args.country.upper():
            raise ValueError(f"--ip {args.ip} is in {country}, not {args.country}")

    opts = launch_options(
        os=args.os,
        locale=args.locale,
        geoip=args.ip or None,
        block_webrtc=not args.ip,
        config={"timezone": args.timezone},
        screen=Screen(min_width=screen[0], max_width=screen[0], min_height=screen[1], max_height=screen[1]),
        # The PC's own GPU, which the profile renders on. Camoufox would otherwise cover
        # the canvas with random data; the profile uses Firefox's Strict canvas
        # randomization instead (launch_browser.py).
        webgl_config=gpu,
        canvas_noise=False,
        headless=False,
        i_know_what_im_doing=True,
    )
    env = opts.get("env", {})
    config = decode_chunks(env, "CAMOU_CONFIG_")
    prefs = {**decode_chunks(env, "CAMOU_PREFS_"), **(opts.get("firefox_user_prefs") or {})}
    strict_screen(config)
    maximize_window(config)
    # A desktop without a touchscreen, stated explicitly: otherwise the page sees neko's
    # touch input device (Firefox reports it as 10 points, Strict collapses that to 5).
    # 0 also turns off window.TouchEvent, as on such a PC.
    config["navigator.maxTouchPoints"] = config.get("navigator.maxTouchPoints") or 0
    # Stock Web Audio. Every x86 PC renders the standard OfflineAudioContext probe the same
    # way, and Firefox (Strict included) adds no audio noise, so a per-profile audio hash
    # would be something no real Firefox has. Seed 0 is Camoufox's "no noise".
    config["audio:seed"] = 0
    ensure_webcam(config)

    fingerprint = summarize(args, config, prefs)
    validate(args, fingerprint, screen, gpu)
    json.dump(fingerprint, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as e:
        sys.exit(f"enclave: cannot generate fingerprint: {e}")

#!/opt/enclave/venv/bin/python
"""Print a new, complete fingerprint for one profile as JSON on stdout.

Run once, at profile creation (docs/05-fingerprints.md). The agent saves the output
as `fingerprint` in profile.json; launch_browser.py replays `raw` on every launch.

Run with no network (docker run --network none): nothing here needs it, and the
real IP of the PC must never be looked up. --ip is resolved with the GeoIP
database bundled in the image.

  gen_fingerprint.py --os windows --country US --timezone America/New_York \
      --locale en-US --ip 198.51.100.10
"""

import argparse
import json
import os
import sys
from importlib.metadata import version

os.environ.setdefault("XDG_CACHE_HOME", os.environ.get("ENCLAVE_CAMOUFOX_CACHE", "/opt/camoufox-cache"))

from camoufox.fingerprints import Screen  # noqa: E402
from camoufox.geolocation import get_geolocation  # noqa: E402
from camoufox.pkgman import camoufox_path  # noqa: E402
from camoufox.utils import launch_options  # noqa: E402

# Stage 1: every profile uses the one desktop size neko's display and Windows have in
# common most often. Stage 3 adds more sizes (each needs a matching neko screen mode).
SCREEN_WIDTH, SCREEN_HEIGHT = 1920, 1080


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--os", default="windows", choices=["windows"])
    p.add_argument("--country", required=True, help="ISO 3166-1 alpha-2 country of the proxy exit IP")
    p.add_argument("--timezone", required=True, help="IANA timezone of the proxy exit IP")
    p.add_argument("--locale", required=True, help="BCP 47 locale, e.g. en-US")
    p.add_argument(
        "--ip",
        help="proxy exit IP: sets geolocation and the IP WebRTC shows. Without it, WebRTC is disabled.",
    )
    return p.parse_args()


def decode_chunks(env: dict, prefix: str) -> dict:
    chunks = sorted((int(k.rsplit("_", 1)[1]), v) for k, v in env.items() if k.startswith(prefix))
    return json.loads("".join(v for _, v in chunks)) if chunks else {}


def maximize_window(config: dict) -> None:
    """The browser window is maximized in the available area (openbox does this with the
    margins prepare_profile.py derives from the same values), so report that geometry."""
    config["window.screenX"] = config.get("screen.availLeft", 0)
    config["window.screenY"] = config.get("screen.availTop", 0)
    config["window.outerWidth"] = config["screen.availWidth"]
    config["window.outerHeight"] = config["screen.availHeight"]
    # Inner size follows from the real window and toolbars; never claim a fixed one.
    config.pop("window.innerWidth", None)
    config.pop("window.innerHeight", None)


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
        "webgl": {"vendor": config["webGl:vendor"], "renderer": config["webGl:renderer"]},
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


def validate(args: argparse.Namespace, fp: dict) -> None:
    problems = []
    if "Windows" not in fp["userAgent"]:
        problems.append(f"user agent is not Windows: {fp['userAgent']}")
    if (fp["screen"]["width"], fp["screen"]["height"]) != (SCREEN_WIDTH, SCREEN_HEIGHT):
        problems.append(f"screen is {fp['screen']['width']}x{fp['screen']['height']}")
    if fp["timezone"] != args.timezone:
        problems.append(f"timezone is {fp['timezone']}, expected {args.timezone}")
    if not fp["fonts"]:
        problems.append("no fonts")
    if problems:
        raise ValueError("; ".join(problems))


def main() -> None:
    args = parse_args()

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
        screen=Screen(
            min_width=SCREEN_WIDTH, max_width=SCREEN_WIDTH, min_height=SCREEN_HEIGHT, max_height=SCREEN_HEIGHT
        ),
        headless=False,
        i_know_what_im_doing=True,
    )
    env = opts.get("env", {})
    config = decode_chunks(env, "CAMOU_CONFIG_")
    prefs = {**decode_chunks(env, "CAMOU_PREFS_"), **(opts.get("firefox_user_prefs") or {})}
    maximize_window(config)

    fingerprint = summarize(args, config, prefs)
    validate(args, fingerprint)
    json.dump(fingerprint, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as e:
        sys.exit(f"enclave: cannot generate fingerprint: {e}")

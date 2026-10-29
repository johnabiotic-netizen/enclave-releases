#!/opt/enclave/venv/bin/python
"""Proxy safety check (docs/06-proxies.md). Run by the agent in a one-off container.

Reads the proxy as JSON on stdin ({type, host, port, username?, password?}) so the
password never appears in arguments or the environment, and prints one JSON object:

  {"tcpOk", "latencyMs", "exitIps", "exitIp", "realIp", "country", "timezone",
   "locale", "lat", "lon", "error"}

The agent decides what passes: this only measures. Exit IPs come from two independent
echo services through the proxy; the real IP from one of them without it. Location comes
from the GeoIP database bundled in the image.
"""

import json
import os
import socket
import subprocess
import sys
import time

os.environ.setdefault("XDG_CACHE_HOME", os.environ.get("ENCLAVE_CAMOUFOX_CACHE", "/opt/camoufox-cache"))

import xml.etree.ElementTree as ET  # noqa: E402
from pathlib import Path  # noqa: E402

import camoufox  # noqa: E402
import camoufox.geolocation  # noqa: E402
from camoufox.geolocation import get_geolocation  # noqa: E402

# The GeoIP database is pinned in the image (Dockerfile geoip-dist). Camoufox would
# re-download it once its data is 8 days old; in these containers that download hangs
# (read-only install), which stopped every proxy check 8 days after the build. The
# database is refreshed by rebuilding the image with a newer pin, never at run time.
camoufox.geolocation.needs_update = lambda config=None: False

# Languages Firefox ships in (its l10n locales, by language). Camoufox picks a country's
# language at random by population, which can give one no Firefox build exists for
# (Nigerian Pidgin for Nigeria): a browser language no real PC reports.
FIREFOX_LANGUAGES = set(
    "af ar az be bg bn bs ca cs cy da de el en eo es et eu fa fi fr fy ga gd gl gu he hi hr hu "
    "hy id is it ja ka kk km kn ko lo lt lv mk ml mr ms my nb ne nl nn pa pl pt ro ru si sk sl "
    "sq sr sv ta te th tl tr uk ur uz vi zh".split()
)
OFFICIAL = ("official", "de_facto_official")


def browser_language(region: str) -> str:
    """The language a browser in `region` most likely runs in: English where it is an
    official language (browsers there overwhelmingly run in English), else the most spoken
    official language Firefox ships in, else English. From CLDR's territoryInfo.xml, which
    the camoufox package bundles."""
    data = ET.parse(Path(camoufox.__file__).parent / "territoryInfo.xml").getroot()
    territory = data.find(f".//territory[@type='{region.upper()}']")
    if territory is None:
        return "en"
    official = sorted(
        (
            (float(lp.get("populationPercent", "0")), lp.get("type", "").split("_")[0])
            for lp in territory.findall("languagePopulation")
            if lp.get("officialStatus") in OFFICIAL
        ),
        reverse=True,
    )
    languages = [lang for _, lang in official]
    if "en" in languages:
        return "en"
    return next((lang for lang in languages if lang in FIREFOX_LANGUAGES), "en")

ECHO_SERVICES = ["https://api.ipify.org", "https://icanhazip.com"]
SCHEMES = {"socks5": "socks5h", "http": "http", "https": "https"}


def curl_config_value(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fetch_ip(url: str, proxy: dict | None) -> str:
    config = [f"url = {curl_config_value(url)}", "silent", "show-error", "fail", "max-time = 20"]
    if proxy:
        scheme = SCHEMES[proxy["type"]]
        config.append(f"proxy = {curl_config_value(f'{scheme}://{proxy['host']}:{proxy['port']}')}")
        if proxy.get("username"):
            user = f"{proxy['username']}:{proxy.get('password', '')}"
            config.append(f"proxy-user = {curl_config_value(user)}")
    out = subprocess.run(
        ["curl", "-K", "-"], input="\n".join(config) + "\n", capture_output=True, text=True, timeout=30
    )
    if out.returncode != 0:
        raise RuntimeError(f"{url}: {out.stderr.strip() or f'curl exit {out.returncode}'}")
    return out.stdout.strip()


def main() -> dict:
    proxy = json.load(sys.stdin)
    if proxy.get("type") not in SCHEMES:
        return {"error": f"unsupported proxy type: {proxy.get('type')!r}"}
    result: dict = {"tcpOk": False}

    started = time.monotonic()
    try:
        with socket.create_connection((proxy["host"], int(proxy["port"])), timeout=5):
            pass
    except OSError as e:
        result["error"] = f"cannot reach the proxy at {proxy['host']}:{proxy['port']}: {e}"
        return result
    result["tcpOk"] = True
    result["latencyMs"] = round((time.monotonic() - started) * 1000)

    try:
        result["exitIps"] = [fetch_ip(url, proxy) for url in ECHO_SERVICES]
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        result["error"] = f"the proxy did not carry traffic: {e}"
        return result
    result["exitIp"] = result["exitIps"][0]

    try:
        result["realIp"] = fetch_ip(ECHO_SERVICES[0], None)
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        result["realIpError"] = str(e)

    try:
        geo = get_geolocation(result["exitIp"])
        locale = geo.locale
        language = browser_language(locale.region) if locale.region else locale.language
        result.update(
            country=locale.region,
            timezone=geo.timezone,
            locale=f"{language}-{locale.region}" if locale.region else language,
            lat=geo.latitude,
            lon=geo.longitude,
        )
    except Exception as e:  # the GeoIP library raises its own types
        result["geoError"] = f"no location for {result['exitIp']}: {e}"
    return result


if __name__ == "__main__":
    try:
        out = main()
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        out = {"error": f"bad proxy settings: {e}"}
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")

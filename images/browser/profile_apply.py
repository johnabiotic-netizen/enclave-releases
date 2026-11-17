#!/opt/session/venv/bin/python

import ipaddress
import json
import re
import socket
import sys

import yaml

PROFILE_JSON = "/config/profile.json"
PROXY_JSON = "/config/proxy.json"
OPENBOX_TEMPLATE = "/etc/neko/openbox.xml"
OUT = "/run/session"

LISTEN = "127.0.0.1:1080"

CONNECTORS = {
    "socks5": ("socks5", "tcp"),
    "http": ("http", "tcp"),
    "https": ("http", "tls"),
}

def proxy_address(proxy: dict) -> tuple[str, int]:
    """The proxy's IPv4 address and port. IPv6-only proxies are not supported yet."""
    host, port = proxy.get("host"), proxy.get("port")
    if not host or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("proxy host and port are required")
    try:
        return str(ipaddress.IPv4Address(host)), port
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ValueError(f"cannot resolve proxy host {host!r}: {e}") from None
    return infos[0][4][0], port

def gost_config(proxy: dict, ip: str, port: int) -> dict:
    kind = proxy.get("type")
    if kind not in CONNECTORS:
        raise ValueError(f"unsupported proxy type: {kind!r}")

    connector_type, dialer_type = CONNECTORS[kind]
    connector: dict = {"type": connector_type}
    if proxy.get("username"):
        connector["auth"] = {"username": proxy["username"], "password": proxy.get("password", "")}
    dialer: dict = {"type": dialer_type}
    if dialer_type == "tls":
        dialer["tls"] = {"serverName": proxy["host"], "secure": True}

    return {
        "log": {"level": "warn"},
        "services": [
            {
                "name": "local",
                "addr": LISTEN,
                "handler": {"type": "socks5", "chain": "upstream"},
                "listener": {"type": "tcp"},
            }
        ],
        "chains": [
            {
                "name": "upstream",
                "hops": [
                    {
                        "name": "proxy",
                        "nodes": [
                            {
                                "name": "proxy",
                                "addr": f"{ip}:{port}",
                                "connector": connector,
                                "dialer": dialer,
                            }
                        ],
                    }
                ],
            }
        ],
    }

def screen_of(profile: dict) -> dict:
    config = ((profile.get("fingerprint") or {}).get("raw") or {}).get("config") or {}
    try:
        width, height = config["screen.width"], config["screen.height"]
    except KeyError:
        raise ValueError("profile.json has no saved fingerprint screen") from None
    return {
        "width": width,
        "height": height,
        "x": config.get("window.screenX", 0),
        "y": config.get("window.screenY", 0),
        "outer_width": config.get("window.outerWidth", width),
        "outer_height": config.get("window.outerHeight", height),
    }

def openbox_config(template: str, screen: dict) -> str:
    margins = "".join(f"  <{side}>0</{side}>\n" for side in ("top", "bottom", "left", "right"))
    result, count = re.subn(r"<margins>.*?</margins>", f"<margins>\n{margins}</margins>", template, flags=re.S)
    if count != 1:
        raise ValueError("openbox template has no <margins> section")
    window = (
        f"<position force=\"yes\"><x>{screen['x']}</x><y>{screen['y']}</y></position>\n"
        f"      <size><width>{screen['outer_width']}</width><height>{screen['outer_height']}</height></size>\n"
        "      <maximized>false</maximized>"
    )
    result, count = re.subn(
        r"<!-- SESSION_WINDOW:[^>]*-->\s*<maximized>true</maximized>", lambda _: window, result
    )
    if count != 1:
        raise ValueError("openbox template has no SESSION_WINDOW rule")
    return result

def main() -> None:
    with open(PROFILE_JSON, encoding="utf-8") as f:
        screen = screen_of(json.load(f))
    with open(PROXY_JSON, encoding="utf-8") as f:
        settings = json.load(f)
    ip, port = proxy_address(settings)
    proxy = gost_config(settings, ip, port)
    with open(OPENBOX_TEMPLATE, encoding="utf-8") as f:
        openbox = openbox_config(f.read(), screen)

    with open(f"{OUT}/gost.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(proxy, f, sort_keys=False)
    with open(f"{OUT}/openbox.xml", "w", encoding="utf-8") as f:
        f.write(openbox)
    with open(f"{OUT}/neko.env", "w", encoding="utf-8") as f:
        display_width = -(-screen["width"] // 8) * 8
        f.write(f"NEKO_DESKTOP_SCREEN={display_width}x{screen['height']}@30\n")
    with open(f"{OUT}/egress.env", "w", encoding="utf-8") as f:
        f.write(f"PROXY_IP={ip}\nPROXY_PORT={port}\n")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as e:
        sys.exit(f"session: cannot prepare profile: {e}")

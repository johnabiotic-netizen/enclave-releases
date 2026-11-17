#!/opt/session/venv/bin/python

import json
import os
import sys
import time
import traceback

import launch  # sets XDG_CACHE_HOME for the camoufox package first
from camoufox.utils import attach_context_defaults
from playwright.sync_api import sync_playwright

AUDIT_JSON = "/config/diag.json"
OUT_DIR = "/data/diag"
PAGES_DIR = "/opt/session/diag"

CHECKS = {
    "probe": (f"file://{PAGES_DIR}/probe.html", "document.getElementById('out').textContent.startsWith('{')", 30),
    "metrics": (f"file://{PAGES_DIR}/metrics.html", "document.getElementById('out').textContent.startsWith('{')", 30),
    "svg-emoji": (f"file://{PAGES_DIR}/svg-emoji.html", "document.getElementById('out').textContent.startsWith('{')", 30),
    "scan": (
        "https://pixelscan.net/fingerprint-check",
        "/Your Browser Fingerprint is\\s+(consistent|inconsistent)/.test(document.body.innerText)"
        " && !/Collecting Data/.test(document.body.innerText)",
        90,
    ),
    "deep": (
        "https://abrahamjuliot.github.io/creepjs/",
        "/FP ID:/.test(document.body.innerText) && /\\nAudio/.test(document.body.innerText)"
        " && !/loading/i.test((document.querySelector('.fingerprint-header') || {}).innerText || '')",
        90,
    ),
    "leak": (
        "https://browserleaks.com/webrtc",
        r"/Public IP Address\s+\d+\.\d+\.\d+\.\d+/.test(document.body.innerText)",
        60,
    ),
    "draw": ("https://browserleaks.com/canvas", "/Signature\\s+[0-9A-F]{32}/.test(document.body.innerText)", 60),
    "crowd": ("https://amiunique.org/fingerprint", "/You are (not )?unique|unique among/i.test(document.body.innerText)", 90),
}
OWN_PAGES = {"probe", "metrics", "svg-emoji"}
SETTLE_SECONDS = {"deep": 10, "scan": 5, "crowd": 5}
EXTRA_JS = {
    "deep": (
        "Array.from(document.querySelectorAll('.lies, .rejected'))"
        r".map(e => (e.closest('div') || e).innerText.trim().split('\n')[0].slice(0, 120))"
    ),
}

def scroll_through(page) -> None:
    """Some pages fill in sections only once they are scrolled into view."""
    height = page.evaluate("document.documentElement.scrollHeight")
    for y in range(0, int(height) + 1, 600):
        page.evaluate(f"window.scrollTo(0, {y})")
        time.sleep(0.3)
    page.evaluate("window.scrollTo(0, 0)")

def run_check(context, name: str) -> dict:
    url, ready, timeout = CHECKS[name]
    page = context.new_page()
    started = time.monotonic()
    result: dict = {"name": name, "url": url}
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        page.wait_for_function(ready, timeout=timeout * 1000, polling=500)
        if name not in OWN_PAGES:
            scroll_through(page)
        time.sleep(SETTLE_SECONDS.get(name, 0))
        if name in EXTRA_JS:
            result["extra"] = page.evaluate(EXTRA_JS[name])
        if name in OWN_PAGES:
            result["data"] = json.loads(page.eval_on_selector("#out", "e => e.textContent"))
        else:
            result["text"] = page.evaluate("document.body.innerText")
        result["status"] = "ok"
    except Exception as e:  # a site that is down or changed: keep what there is
        result["status"] = "error"
        result["error"] = f"{type(e).__name__}: {e}".splitlines()[0][:500]
        try:
            result["text"] = page.evaluate("document.body.innerText")
        except Exception:
            pass
    try:
        page.screenshot(path=os.path.join(OUT_DIR, f"{name}.png"), full_page=True, timeout=30000)
        result["screenshot"] = f"{name}.png"
    except Exception:
        pass
    result["seconds"] = round(time.monotonic() - started, 1)
    page.close()
    return result

def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    done = os.path.join(OUT_DIR, "result.json")
    if os.path.exists(done):
        while True:
            time.sleep(3600)

    with open(AUDIT_JSON, encoding="utf-8") as f:
        wanted = json.load(f).get("checks") or list(CHECKS)
    unknown = [c for c in wanted if c not in CHECKS]
    report: dict = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": []}
    try:
        if unknown:
            raise ValueError(f"unknown checks: {', '.join(unknown)}")
        binary, env = launch.prepare_launch()
        with sync_playwright() as p:
            browser = p.firefox.launch(
                executable_path=binary,
                env=env,
                headless=False,
                firefox_user_prefs=launch.USER_PREFS,
            )
            attach_context_defaults(browser, True)
            context = browser.new_context()
            for name in wanted:
                report["checks"].append(run_check(context, name))
            context.close()
            browser.close()
    except Exception:
        report["error"] = traceback.format_exc()[-2000:]
    report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tmp = done + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(report, f)
    os.replace(tmp, done)
    while True:
        time.sleep(3600)

if __name__ == "__main__":
    sys.exit(main())

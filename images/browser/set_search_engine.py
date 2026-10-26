#!/usr/bin/env python3
"""Build step: give Camoufox a working default search engine.

Camoufox's policies.json removes every search engine and installs a dummy "None"
(POST to 127.0.0.1), so a search typed in the address bar goes nowhere. Replace that
with Google, Firefox's own default. Search engines are not visible to websites, so
this does not affect the fingerprint.

  set_search_engine.py <path to distribution/policies.json>
"""

import json
import sys

GOOGLE = {
    "Name": "Google",
    "Description": "Google Search",
    "Alias": "@google",
    "Method": "GET",
    "URLTemplate": "https://www.google.com/search?client=firefox-b-d&q={searchTerms}",
    "IconURL": "https://www.google.com/favicon.ico",
}


def main(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    engines = doc["policies"]["SearchEngines"]
    if engines.get("Default") != "None":
        sys.exit(f"unexpected Camoufox search policy (Default={engines.get('Default')!r}); check this step")
    engines["Remove"] = [name for name in engines.get("Remove", []) if name != "Google"]
    engines["Add"] = [GOOGLE]
    engines["Default"] = "Google"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])

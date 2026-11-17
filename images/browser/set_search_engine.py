#!/usr/bin/env python3

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

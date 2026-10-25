# Browser image

The Docker image every profile runs: neko v3 base + Camoufox + Windows fonts + the egress lock entrypoint + the fingerprint generator. Build per `stages/stage-1-local-core.md` (tasks B and C) and `docs/05-fingerprints.md`. Verify current neko and Camoufox details before writing the Dockerfile (see the stage's "Verify first").

Expected contents once built:
- Dockerfile
- start-browser.sh (reads /config, launches Camoufox with saved fingerprint + proxy, data at /data)
- entrypoint.sh (applies the fail-closed egress firewall before the browser starts)
- gen_fingerprint.py (prints validated fingerprint JSON)
- supervisord config

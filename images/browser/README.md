# Browser image

The Docker image every profile runs: neko v3 base (display, audio, WebRTC streaming) + Camoufox + fonts + a local proxy forwarder + the fingerprint generator. Versions and the reasons behind them are in `progress/DECISIONS.md` (2026-10-26 entries).

## Build

```powershell
.\scripts\build-image.ps1            # tag enclave-browser:dev
```

or inside WSL / Linux: `scripts/build-image.sh [tag]`. Big downloads are cached in `/var/cache/enclave/<stage>/` so rebuilds don't fetch them again. Every file's sha256 is checked either way.

The image is about 4.5 GB (Camoufox alone is 2.4 GB unpacked). A full rebuild needs about 8 GB free inside Docker.

## Files

| File | Role |
|---|---|
| `Dockerfile` | Pinned base, packages, Python lock, checksummed downloads |
| `requirements.lock` | Every Python package, exact versions (installed with `--no-deps`) |
| `entrypoint.sh` | Root setup, then supervisord. With arguments, runs them instead (one-off commands) |
| `prepare_profile.py` | Resolves the proxy host once, then writes `/run/enclave/{gost.yaml, openbox.xml, neko.env, egress.env}` |
| `apply_egress_lock.sh` | The egress lock: only the forwarder may connect, only to the proxy; DNS and IPv6 refused |
| `set_search_engine.py` | Build step: Google as default search engine (Camoufox ships with none) |
| `supervisord.conf` | openbox, `proxy` (gost as user `egress`), `camoufox` (as `neko`) |
| `start-browser.sh` / `launch_browser.py` | Starts Camoufox from the saved fingerprint only. Never generates one |
| `gen_fingerprint.py` | Prints a new fingerprint as JSON (run once per profile, `--network none`) |
| `openbox.xml` | Window manager config template (from neko's Firefox app) |

## Runtime contract

Mounts:
- `/config/profile.json` (read only): the profile, including `fingerprint.raw`.
- `/config/proxy.json` (read only): `{type, host, port, username?, password?}`. Holds the password, so it is never logged.
- `/data`: persistent browser data (`/data/profile`). Use a Docker volume, not a Windows folder.

Docker flags: `--cap-add NET_ADMIN` (required: without it the entrypoint refuses to start the browser) and `--shm-size 2g`. The entrypoint applies the lock as root, then drops NET_ADMIN and NET_RAW for every process it starts, so nothing in the container can lift the lock. `docker exec` sessions still get the container's capabilities: only someone with Docker access can do that.

Environment set by the agent: `NEKO_MEMBER_PROVIDER=multiuser`, `NEKO_MEMBER_MULTIUSER_USER_PASSWORD`, `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD`, `NEKO_WEBRTC_TCPMUX` / `NEKO_WEBRTC_UDPMUX` (one port), `NEKO_WEBRTC_ICELITE=true`, `NEKO_WEBRTC_NAT1TO1=127.0.0.1`. The screen size comes from the fingerprint automatically.

Ports: 8080 (web client and API) and the mux port, published on `127.0.0.1` only. On Docker Engine in WSL, only TCP reaches Windows (WSL forwards TCP only), so WebRTC uses the TCP mux port.

Fingerprint generation:

```bash
docker run --rm --network none enclave-browser:dev /opt/enclave/gen_fingerprint.py \
  --country US --timezone America/New_York --locale en-US --ip <proxy exit IP>
```

Stop profiles with `docker stop` (graceful, at least 10 s), not `docker rm -f`. Firefox saves open tabs every few seconds, and a kill loses the latest ones.

## Known gaps

- The proxy host is resolved once at container start. A proxy whose hostname changes IP needs a profile restart. IPv6-only proxies are not supported yet.
- `https` proxies (TLS to the proxy) are written but not yet tested against a real one.
- Stage 3: openbox still draws a title bar on Camoufox, so `outerHeight` is larger than `screen.availHeight`. Screen size is fixed at 1920x1080 for now.

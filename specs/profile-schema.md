# Profile schema

Each profile is a folder on the host: `profiles/<id>/`, containing `profile.json`, a `data/` directory (the browser's persistent data, mounted to `/data` in the container), `baselines/` (fingerprint baselines), and `logs/`.

`profile.json` shape (authoritative JSON Schema in `specs/schemas/profile.schema.json`):

```jsonc
{
  "id": "uuid-v4",
  "name": "Client A - Instagram",
  "createdAt": "2026-10-25T10:00:00Z",
  "updatedAt": "2026-10-25T10:00:00Z",
  "notes": "optional free text",

  "proxy": {
    "type": "socks5",            // socks5 | http | https
    "host": "198.51.100.10",
    "port": 1080,
    "username": "user",
    "secretRef": "keyring:profile-<id>-proxy", // reference, not the password
    "lastCheck": {
      "at": "2026-10-25T10:00:00Z",
      "ok": true,
      "exitIp": "198.51.100.10",
      "country": "US", "city": "New York",
      "timezone": "America/New_York",
      "latencyMs": 180
    }
  },

  "fingerprint": {
    "os": "windows",
    "camoufoxVersion": "x.y.z",
    "generatorVersion": "x.y.z",
    "userAgent": "...",
    "screen": { "width": 1920, "height": 1080, "availHeight": 1040, "colorDepth": 24, "devicePixelRatio": 1 },
    "hardware": { "cores": 8 },     // memoryGb optional: Firefox does not expose device memory
    "webgl": { "vendor": "Google Inc. (NVIDIA)", "renderer": "ANGLE (...)", "...": "..." },
    "canvasSeed": "hex",           // optional: Camoufox >= 156.0.1-beta.32 adds no canvas noise, so none is generated
    "audioSeed": "hex",
    "fonts": ["Arial", "Calibri", "..."],
    "locale": "en-US",
    "languages": ["en-US", "en"],
    "timezone": "America/New_York",
    "geolocation": { "lat": 40.71, "lon": -74.0, "accuracy": 50 },  // accuracy optional
    "mediaDevices": [
      { "kind": "videoinput", "label": "Integrated Camera" },
      { "kind": "audioinput", "label": "Microphone" },
      { "kind": "audiooutput", "label": "Speakers" }
    ],
    "webrtc": "proxy-only",      // proxy-only | disabled
    "raw": { "config": { "...": "Camoufox config (CAMOU_CONFIG)" }, "prefs": { "...": "Firefox prefs" } }
    // raw is what the browser actually uses; the fields above are a readable summary of it
  },

  "runtime": {
    "idleStopMinutes": 20,
    "screenMatchesFingerprint": true,
    "usesTestProxy": false          // optional: made with TEST_PROXY (PC's own IP), not for real accounts
  },

  "status": {
    "state": "stopped",          // stopped | starting | running | error
    "containerId": null,
    "streamPort": null,
    "lastError": null,
    "lastStartedAt": null
  }
}
```

## Rules
- `fingerprint` is written once at creation. Only `timezone`, `locale`, `languages`, `geolocation` may change later, and only via the explicit "Update location" action when the proxy's country changes. All other fields are immutable for the life of the profile.
- Changing the proxy (same country and timezone, enforced) moves `geolocation` to the new exit IP's location. At every start the browser reports the IP and location from that start's proxy check (`ENCLAVE_EXIT_IP`, `ENCLAVE_EXIT_LAT`, `ENCLAVE_EXIT_LON`), not the values saved at creation, so WebRTC and geolocation always agree with the IP websites see (hard rule 3).
- The proxy password is never stored in `profile.json`. Only `secretRef` is.
- `status` is runtime only and may be rewritten freely.

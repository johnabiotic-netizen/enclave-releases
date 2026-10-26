# Third party notices

Keep this current as dependencies are added. For each, record name, version, license, and a link to its license text.

| Component | Version | License | Notes |
|---|---|---|---|
| Camoufox (browser build) | 156.0.1-beta.36 | MPL 2.0 | https://github.com/daijro/camoufox. If we modify its source files, publish those changes. |
| camoufox (Python package) | 0.5.8 | MIT | Launcher and fingerprint generator, inside the browser image. |
| Firefox (via Camoufox) | 156.0.1 | MPL 2.0 | Do not use Firefox branding. |
| neko (base image) | 3.2.0 | Apache 2.0 | https://github.com/m1k1o/neko. Keep NOTICE file. `images/browser/openbox.xml` is adapted from neko's `apps/firefox/openbox.xml`. |
| gost | 3.3.1 | MIT | https://github.com/go-gost/gost. Local proxy forwarder in the browser image. |
| uBlock Origin | 1.75.0 | GPL 3.0 | https://github.com/gorhill/uBlock. Unmodified; Camoufox's default add-on. |
| GeoIP AIO database | release 2026.10.21 | See https://github.com/daijro/geoip-all-in-one (combines several GeoIP sources, each with its own terms; check before the product launch). | Offline IP to location lookup at fingerprint generation. |
| fpgen model | model-2/2026 | See https://github.com/scrapfly/fingerprint-generator | Fingerprint distribution data used by Camoufox's generator. |
| Python packages in the image | see `images/browser/requirements.lock` | Mostly MIT, BSD and Apache 2.0 | Audit individually before the product launch. |

(Expand as the dependency list grows: Node packages, coturn, etc.)

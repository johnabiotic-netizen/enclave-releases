# Enclave browser image: neko v3 (display, audio, WebRTC streaming) + Camoufox (browser).
# Build with scripts/build-image.sh (or .ps1). See images/browser/README.md.

# --- Pinned downloads -------------------------------------------------------
# Each stage can be swapped for a local folder holding the same file with
# --build-context <stage>=<dir>; the checksums are re-checked below either way.

# Camoufox v158.0-beta.40 built with Enclave's patches (Windows text metrics; phone
# camera and mic, answering sites like a 720p laptop webcam, never a black frame between
# two good ones) by the private repo enclave-camoufox (workflow "Enclave build", run
# 41228590512 of 2026-10-31). It has no public URL: scripts/build-image.sh supplies it
# from $ENCLAVE_DIST_CACHE/camoufox/.
# The URL below is the stock release, kept only as the stage's source; its checksum
# differs, so a build without our zip in the cache fails rather than using stock Camoufox.
FROM scratch AS camoufox-dist
ADD --checksum=sha256:16556f40ae89f17b943e88813a81fba63e368d39ae7f98b628b21aeb80d3d3f4 \
    https://github.com/daijro/camoufox/releases/download/v158.0-beta.40/camoufox-158.0-beta.40-lin.x86_64.zip \
    /camoufox.zip

FROM scratch AS geoip-dist
ADD --checksum=sha256:1823c162efe356bb8a588f10f027c41bd19d742cd00b4696d8f74ea0a3856358 \
    https://github.com/daijro/geoip-all-in-one/releases/download/2026.10.21/geoip-aio-all.mmdb.zip \
    /geoip-aio-all.mmdb.zip

FROM scratch AS ublock-dist
ADD --checksum=sha256:5b74415860456370644bd80f16125e865b0e6c356bb5dfcfb84069967eaa5287 \
    https://github.com/gorhill/uBlock/releases/download/1.75.0/uBlock0_1.75.0.firefox.signed.xpi \
    /ublock-origin.xpi

FROM scratch AS gost-dist
ADD --checksum=sha256:e0e3a2c9116e2f025e962bba340749f80696bda318613d45e5ae96dd0bcae37c \
    https://github.com/go-gost/gost/releases/download/v3.3.1/gost_3.3.1_linux_amd64.tar.gz \
    /gost.tar.gz

# neko v3.2.0's server with Enclave's patches (the webcam goes to a named pipe, every
# frame; no transport-cc, so the phone camera reaches full size over TCP), built by the
# private repo enclave-camoufox (workflow "Enclave neko build", run of 2026-10-31). No
# public URL: scripts/build-image.sh supplies it from
# $ENCLAVE_DIST_CACHE/neko/; without it this stage is empty and the checksum below fails.
FROM scratch AS neko-dist

# --- GL shim (gl_shim.c), built apart so the image carries no compiler ----------

FROM ghcr.io/m1k1o/neko/base:3.2.0@sha256:587a3389b6b99c8999eb00a768c79205a74647c57cf5b9695a90234a0edaa446 AS gl-shim
COPY gl_shim.c /src/gl_shim.c
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends gcc-14=14.2.0-19 libc6-dev=2.41-12+deb13u4; \
    gcc-14 -O2 -Wall -Werror -shared -fPIC -o /libenclave_gl.so /src/gl_shim.c -ldl

# --- Image -------------------------------------------------------------------

FROM ghcr.io/m1k1o/neko/base:3.2.0@sha256:587a3389b6b99c8999eb00a768c79205a74647c57cf5b9695a90234a0edaa446

# Camoufox browser build. The folder suffix is the first 8 hex chars of the zip's sha256,
# which is how the camoufox package names its installs.
ARG CAMOUFOX_INSTALL=browsers/official/158.0-beta.40-16556f40
ARG CAMOUFOX_SHA256=16556f40ae89f17b943e88813a81fba63e368d39ae7f98b628b21aeb80d3d3f4
ARG GEOIP_SHA256=1823c162efe356bb8a588f10f027c41bd19d742cd00b4696d8f74ea0a3856358
ARG UBLOCK_SHA256=5b74415860456370644bd80f16125e865b0e6c356bb5dfcfb84069967eaa5287
ARG GOST_SHA256=e0e3a2c9116e2f025e962bba340749f80696bda318613d45e5ae96dd0bcae37c

# Where the camoufox package keeps its browser, GeoIP database and add-ons
# (it uses $XDG_CACHE_HOME/camoufox). Our scripts set XDG_CACHE_HOME to this.
ENV ENCLAVE_CAMOUFOX_CACHE=/opt/camoufox-cache

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      python3.13-venv=3.13.5-2+deb13u5 \
      python3-venv=3.13.5-1 \
      openbox=3.6.1-12+b2 \
      unzip=6.0-29+deb13u1 \
      libdbus-glib-1-2=0.114-1 \
      libpci3=1:3.13.0-2 \
      fonts-liberation=1:2.1.5-3 \
      fonts-liberation2=1:2.1.5-3 \
      fonts-croscore=20201225-2 \
      fonts-crosextra-carlito=20230309-2 \
      fonts-crosextra-caladea=20200211-2 \
      fonts-noto-core=20201225-2 \
      fonts-noto-cjk=1:20240730+repack1-1; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# User for the proxy forwarder. Task C's firewall lets only this user reach the proxy.
RUN useradd --system --uid 1100 --no-create-home --shell /usr/sbin/nologin egress

COPY requirements.lock /opt/enclave/requirements.lock
RUN set -eux; \
    python3 -m venv /opt/enclave/venv; \
    /opt/enclave/venv/bin/pip install --no-cache-dir --no-deps --require-virtualenv \
      --retries 10 --timeout 60 --resume-retries 10 -r /opt/enclave/requirements.lock; \
    /opt/enclave/venv/bin/pip check

RUN --mount=type=bind,from=camoufox-dist,target=/dist/camoufox \
    --mount=type=bind,from=geoip-dist,target=/dist/geoip \
    --mount=type=bind,from=ublock-dist,target=/dist/ublock \
    set -eux; \
    echo "${CAMOUFOX_SHA256}  /dist/camoufox/camoufox.zip" | sha256sum -c -; \
    echo "${GEOIP_SHA256}  /dist/geoip/geoip-aio-all.mmdb.zip" | sha256sum -c -; \
    echo "${UBLOCK_SHA256}  /dist/ublock/ublock-origin.xpi" | sha256sum -c -; \
    c="${ENCLAVE_CAMOUFOX_CACHE}/camoufox"; \
    mkdir -p "$c/${CAMOUFOX_INSTALL}" "$c/geoip/mmdb" "$c/addons/UBO"; \
    # unzip exits 1 on warnings: the zip's Japanese font names trigger "mismatching local filename".
    unzip -q /dist/camoufox/camoufox.zip -d "$c/${CAMOUFOX_INSTALL}" || [ "$?" -eq 1 ]; \
    unzip -q -p /dist/geoip/geoip-aio-all.mmdb.zip geoip-aio-all.mmdb > "$c/geoip/mmdb/geoip aio by daijro-combined.mmdb"; \
    printf 'name: GeoIP AIO by daijro\n' > "$c/geoip/config.yml"; \
    unzip -q /dist/ublock/ublock-origin.xpi -d "$c/addons/UBO"; \
    # The same metadata `camoufox fetch` writes, so the package recognises the install.
    printf '{"version":"158.0","build":"beta.40","prerelease":true,"asset_size":1299054257,"sha256":"%s","interface":1}\n' \
      "${CAMOUFOX_SHA256}" > "$c/${CAMOUFOX_INSTALL}/version.json"; \
    printf '{"active_version": "%s"}\n' "${CAMOUFOX_INSTALL}" > "$c/config.json"; \
    touch "$c/.0.5_FLAG"; \
    XDG_CACHE_HOME="${ENCLAVE_CAMOUFOX_CACHE}" /opt/enclave/venv/bin/python -c \
      'from camoufox.fpgen_model import ensure_fpgen_model; ensure_fpgen_model()'; \
    XDG_CACHE_HOME="${ENCLAVE_CAMOUFOX_CACHE}" /opt/enclave/venv/bin/python -m camoufox version; \
    XDG_CACHE_HOME="${ENCLAVE_CAMOUFOX_CACHE}" /opt/enclave/venv/bin/python -m camoufox version | grep -q 'Installed *Yes'; \
    # Camoufox loads its bundled libraries (NSS and others) from its own folder.
    missing="$(LD_LIBRARY_PATH="$c/${CAMOUFOX_INSTALL}" ldd "$c/${CAMOUFOX_INSTALL}/camoufox-bin" "$c/${CAMOUFOX_INSTALL}/libxul.so" | grep 'not found' || true)"; \
    test -z "$missing" || { echo "Missing libraries: $missing"; exit 1; }; \
    chmod -R 755 "$c/${CAMOUFOX_INSTALL}"; \
    chmod -R a+rX "${ENCLAVE_CAMOUFOX_CACHE}"

# Text as Windows lays it out: Windows Firefox (DirectWrite) uses exact glyph advances;
# Camoufox's fontconfig asks FreeType for full hinting, which rounds every advance to a
# pixel (Arial at 100px: 660 instead of Windows' 656.017) and gave one emoji sequence
# 71 million px of bounds in getBBox(). Measured against Windows Firefox 158 on the
# owner's PC, 2026-10-27: unhinted widths match exactly.
RUN set -eux; \
    f="$(echo "${ENCLAVE_CAMOUFOX_CACHE}"/camoufox/browsers/official/*/fontconfig/windows/fonts.conf)"; \
    sed -i \
      -e 's#<edit name="hinting" mode="assign"><bool>true</bool></edit>#<edit name="hinting" mode="assign"><bool>false</bool></edit>#' \
      -e 's#<edit name="hintstyle" mode="assign"><const>hintfull</const></edit>#<edit name="hintstyle" mode="assign"><const>hintnone</const></edit>#' \
      "$f"; \
    grep -q '<edit name="hinting" mode="assign"><bool>false</bool></edit>' "$f"; \
    grep -q '<const>hintnone</const>' "$f"

# Camoufox writes its fontconfig file on first use. It depends only on the bundled
# fonts, so create it now and keep the install read-only for the browser user.
RUN XDG_CACHE_HOME="${ENCLAVE_CAMOUFOX_CACHE}" /opt/enclave/venv/bin/python -c \
      'from camoufox.utils import get_env_vars; print(get_env_vars({}, "win")["FONTCONFIG_FILE"])' \
    && chmod -R a+rX "${ENCLAVE_CAMOUFOX_CACHE}/camoufox/fontconfig"

# Camoufox ships with no search engine ("None"); make Google the default.
COPY set_search_engine.py /tmp/set_search_engine.py
RUN set -eux; \
    p="$(echo "${ENCLAVE_CAMOUFOX_CACHE}"/camoufox/browsers/official/*/distribution/policies.json)"; \
    test -f "$p"; \
    python3 /tmp/set_search_engine.py "$p"; \
    chmod 0644 "$p"; \
    rm /tmp/set_search_engine.py

RUN --mount=type=bind,from=gost-dist,target=/dist/gost \
    set -eux; \
    echo "${GOST_SHA256}  /dist/gost/gost.tar.gz" | sha256sum -c -; \
    tar -xzf /dist/gost/gost.tar.gz -C /usr/local/bin gost; \
    chmod 0755 /usr/local/bin/gost; \
    gost -V

# neko's web client takes a PC with a touchscreen for a tablet and then never focuses its key
# input: clicks work, typing doesn't. The owner's PC (touchscreen + mouse) reports no fine
# pointer and no hover at all, so no media query can tell. Force mouse/keyboard mode; phones
# use our own viewer (Stage 4). The ?v= query makes browsers drop a cached unpatched copy.
# The build fails if the code no longer matches.
RUN set -eux; \
    f="$(grep -rlF '("ontouchstart"in window||navigator.maxTouchPoints>0)&&!matchMedia' /var/www/assets)"; \
    test "$(echo "$f" | wc -l)" = 1; \
    sed -i 's/("ontouchstart"in window||navigator.maxTouchPoints>0)&&!matchMedia/false\&\&!matchMedia/' "$f"; \
    grep -qF 'inputMode==="touch":false&&' "$f"; \
    b="$(basename "$f")"; \
    sed -i "s#${b}\"#${b}?v=enclave1\"#" /var/www/index.html; \
    grep -qF "${b}?v=enclave1" /var/www/index.html

# Screen sizes profiles may claim (gen_fingerprint.py SCREENS) need a display mode at the
# 30 Hz neko streams at. neko's list lacks 1440x900, 1680x1050, and 1600x900 at 30 Hz
# (timings from gtf). 1366x768 runs on neko's 1368x768 mode: the dummy driver only takes
# widths that are multiples of 8, the page sees the claimed 1366 (Camoufox reports the
# screen size) and the 1366-wide window, and prepare_profile.py picks the mode.
RUN set -eux; \
    f=/etc/neko/xorg.conf; \
    sed -i '/^Section "Monitor"/,/^EndSection/ s|^EndSection|  Modeline "1440x900_30.00"  48.80  1440 1464 1608 1776  900 901 904 916  -HSync +Vsync\n  Modeline "1680x1050_30.00"  67.73  1680 1728 1896 2112  1050 1051 1054 1069  -HSync +Vsync\n  Modeline "1600x900_30.00"  54.52  1600 1632 1792 1984  900 901 904 916  -HSync +Vsync\nEndSection|' "$f"; \
    sed -i 's|^\( *Modes ".*\)$|\1 "1440x900_30.00" "1680x1050_30.00" "1600x900_30.00"|' "$f"; \
    test "$(grep -cE '^ *Modeline "(1440x900|1680x1050|1600x900)_30.00"' "$f")" = 3; \
    grep -q 'Modes .*"1440x900_30.00" "1680x1050_30.00" "1600x900_30.00"' "$f"; \
    grep -q '"1368x768_30.00"' "$f"

COPY openbox.xml /etc/neko/openbox.xml
COPY supervisord.conf /etc/neko/supervisord/enclave.conf
# Screen encoder settings that keep the stream at full frame rate on a 2-core PC (see the file).
COPY neko.yaml /etc/neko/neko.yaml
# Firewall for the egress lock (apply_egress_lock.sh). capsh (libcap2-bin) is in the base.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends iptables=1.8.11-2; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    command -v capsh

# Stage 6: neko runs with its own primary group, "stream", so the egress lock can let it (and
# only it, not the browser) send the phone stream when the PC is linked through the relay.
RUN set -eux; \
    groupadd --system stream; \
    f=/etc/neko/supervisord.conf; \
    sed -i '/^\[program:neko\]/,/^$/ { s|^command=/usr/bin/neko |command=/opt/enclave/run-neko.sh |; s|^user=.*|user=root| }' "$f"; \
    sed -n '/^\[program:neko\]/,/^$/p' "$f" | grep -qx 'command=/opt/enclave/run-neko.sh serve --server.static "/var/www"'; \
    sed -n '/^\[program:neko\]/,/^$/p' "$f" | grep -qx 'user=root'

COPY entrypoint.sh start-browser.sh launch_browser.py prepare_profile.py gen_fingerprint.py windows_gpu.py apply_egress_lock.sh check_proxy.py audit.py camfeed.py run-neko.sh /opt/enclave/
# Check pages for audit runs (audit.py, testing/test-suite.md).
COPY audit/ /opt/enclave/audit/
# Windows line endings break the shebang ("required file not found"): refuse them.
RUN chmod 0755 /opt/enclave/*.sh /opt/enclave/*.py \
    && ! grep -l "$(printf '\r')" /opt/enclave/*.sh /opt/enclave/*.py /etc/neko/supervisord/enclave.conf /etc/neko/neko.yaml

COPY --from=gl-shim /libenclave_gl.so /opt/enclave/libenclave_gl.so

ARG NEKO_SHA256=e88f09ebf4a922dc1f66b84a36010fbc46b928a6efec236e0358cb2676e9e907
RUN --mount=type=bind,from=neko-dist,target=/dist/neko \
    set -eux; \
    echo "${NEKO_SHA256}  /dist/neko/neko" | sha256sum -c -; \
    install -m 0755 /dist/neko/neko /usr/bin/neko

# Stage 4: the phone camera. neko receives it and (Enclave's neko build) writes the
# decoded frames into camfeed.py's pipe; the browser's camera reads them from there.
ENV NEKO_CAPTURE_WEBCAM_ENABLED=true \
    NEKO_CAPTURE_WEBCAM_DEVICE=fifo:/tmp/enclave-camera.fifo \
    NEKO_CAPTURE_WEBCAM_WIDTH=1280 \
    NEKO_CAPTURE_WEBCAM_HEIGHT=720

ENTRYPOINT ["/opt/enclave/entrypoint.sh"]

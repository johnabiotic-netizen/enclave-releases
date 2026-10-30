#!/bin/bash
# Build the browser image. Run where `docker` works (inside WSL on the owner's PC).
#
# Large pinned downloads are cached in $ENCLAVE_DIST_CACHE (default /var/cache/enclave),
# one subfolder per Dockerfile stage (camoufox/camoufox.zip, geoip/..., ublock/..., gost/...,
# neko/neko).
# Files found there are used instead of downloading again; the Dockerfile re-checks
# their sha256 either way. One folder per file, because each build context is sent whole.
#
#   scripts/build-image.sh [tag]      default tag: enclave-browser:dev
set -euo pipefail

tag="${1:-enclave-browser:dev}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
context="$here/../images/browser"
cache="${ENCLAVE_DIST_CACHE:-/var/cache/enclave}"

contexts=()
add_cached() { # <stage> <subfolder> <file>
  if [ -f "$cache/$2/$3" ]; then
    contexts+=(--build-context "$1=$cache/$2")
    echo "using cached $2/$3"
  fi
}
add_cached camoufox-dist camoufox camoufox.zip
add_cached geoip-dist geoip geoip-aio-all.mmdb.zip
add_cached ublock-dist ublock ublock-origin.xpi
add_cached gost-dist gost gost.tar.gz
add_cached neko-dist neko neko

docker build "${contexts[@]}" -t "$tag" "$context"

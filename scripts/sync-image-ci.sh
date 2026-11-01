#!/bin/bash
# Copies images/browser into the private enclave-camoufox repository (enclave-image/),
# where its workflow "Enclave image" builds and publishes the browser image on GitHub's
# servers. Run from this repository's root in Git Bash, after committing images/browser:
#
#   scripts/sync-image-ci.sh [path to enclave-camoufox]     default: ../enclave-camoufox
#
# It commits the copy there (naming this repository's commit) and pushes it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-$here/../enclave-camoufox}"
[ -d "$target/.git" ] || { echo "No enclave-camoufox repository at $target" >&2; exit 1; }
if [ -n "$(git -C "$here" status --porcelain -- images/browser)" ]; then
  echo "Commit images/browser first: only committed files are synced." >&2
  exit 1
fi

commit="$(git -C "$here" rev-parse --short HEAD)"
rm -rf "$target/enclave-image"
mkdir -p "$target/enclave-image"
# Exactly the committed files, with their line endings as committed (LF).
git -C "$here" archive HEAD images/browser | tar -x -C "$target/enclave-image" --strip-components=2
git -C "$target" add -A enclave-image
if git -C "$target" diff --cached --quiet; then
  echo "enclave-image is already up to date."
  exit 0
fi
git -C "$target" commit -q -m "enclave-image: images/browser from Enclave $commit"
git -C "$target" push -q origin HEAD
echo "Synced images/browser from $commit to enclave-camoufox."

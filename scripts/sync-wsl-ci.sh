#!/bin/bash
# Copies images/wsl into the private enclave-camoufox repository (enclave-wsl/),
# where its workflow "Enclave WSL" builds Enclave's WSL system on GitHub's
# servers. Run from this repository's root in Git Bash, after committing images/wsl:
#
#   scripts/sync-wsl-ci.sh [path to enclave-camoufox]     default: ../enclave-camoufox
#
# It commits the copy there (naming this repository's commit) and pushes it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-$here/../enclave-camoufox}"
[ -d "$target/.git" ] || { echo "No enclave-camoufox repository at $target" >&2; exit 1; }
if [ -n "$(git -C "$here" status --porcelain -- images/wsl)" ]; then
  echo "Commit images/wsl first: only committed files are synced." >&2
  exit 1
fi

commit="$(git -C "$here" rev-parse --short HEAD)"
rm -rf "$target/enclave-wsl"
mkdir -p "$target/enclave-wsl"
# Exactly the committed files, with their line endings as committed (LF).
git -C "$here" archive HEAD images/wsl | tar -x -C "$target/enclave-wsl" --strip-components=2
git -C "$target" add -A enclave-wsl
if git -C "$target" diff --cached --quiet; then
  echo "enclave-wsl is already up to date."
  exit 0
fi
git -C "$target" commit -q -m "enclave-wsl: images/wsl from Enclave $commit"
git -C "$target" push -q origin HEAD
echo "Synced images/wsl from $commit to enclave-camoufox."

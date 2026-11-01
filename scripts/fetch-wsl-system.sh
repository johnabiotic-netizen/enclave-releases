#!/bin/bash
# Downloads Enclave's WSL system (enclave-wsl.tar.gz) from a run of the enclave-camoufox
# workflow "Enclave WSL" into packages/desktop/wsl/, where the installer build picks it up, and
# checks it against SYSTEM_SHA256 in packages/desktop/src/main/wsl-system.ts.
#
#   scripts/fetch-wsl-system.sh <run id>
#
# Uses the GitHub login git already has (Git Credential Manager); the token is never printed.
set -euo pipefail
run="${1:?Give the workflow run id}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$here/packages/desktop/wsl"
want="$(sed -n "s/^export const SYSTEM_SHA256 = '\([0-9a-f]*\)';/\1/p" "$here/packages/desktop/src/main/wsl-system.ts")"
token="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
api() { curl -sSfL -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "https://api.github.com$1" "${@:2}"; }
id="$(api "/repos/johnabiotic-netizen/enclave-camoufox/actions/runs/$run/artifacts" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d).artifacts.find(x=>x.name==='enclave-wsl');if(!a)process.exit(1);console.log(a.id)})")"
mkdir -p "$out"
tmp="$(mktemp -d)"
api "/repos/johnabiotic-netizen/enclave-camoufox/actions/artifacts/$id/zip" -o "$tmp/a.zip"
unzip -q -o "$tmp/a.zip" -d "$tmp"
got="$(sha256sum "$tmp/enclave-wsl.tar.gz" | cut -c1-64)"
if [ -n "$want" ] && [ "$got" != "$want" ]; then
  echo "Checksum differs: got $got, wsl-system.ts pins $want." >&2
  rm -rf "$tmp"; exit 1
fi
mv "$tmp/enclave-wsl.tar.gz" "$out/enclave-wsl.tar.gz"
rm -rf "$tmp"
echo "packages/desktop/wsl/enclave-wsl.tar.gz $got"

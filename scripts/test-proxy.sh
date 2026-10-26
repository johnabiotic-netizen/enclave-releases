#!/bin/bash
# Development only: a SOCKS5 proxy on the Docker host, for TEST_PROXY in .env.
# It exits through this PC's own connection, so it hides nothing: profiles made with it are
# labeled "Test proxy, not for real accounts". Run where `docker` runs (on the owner's PC:
# inside WSL as root). Prints the TEST_PROXY line to put in .env.
#
#   scripts/test-proxy.sh [image]
set -euo pipefail

image="${1:-enclave-browser:dev}"
# Listen only on the Docker bridge gateway: profiles reach it as host.docker.internal, and
# nothing outside this machine can.
gateway="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')"
password="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"

docker rm -f enclave-test-proxy >/dev/null 2>&1 || true
docker run -d --name enclave-test-proxy --restart unless-stopped --network host \
  --entrypoint /usr/local/bin/gost "$image" \
  -L "socks5://tester:${password}@${gateway}:1081" >/dev/null

echo "TEST_PROXY=socks5://tester:${password}@host.docker.internal:1081"

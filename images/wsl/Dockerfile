# Enclave's own small Linux system for WSL (Stage 7, easier install): Debian 13 with Docker
# Engine, so a PC without Docker Desktop runs profiles with nothing else to install. Built by
# the private repo enclave-camoufox (workflow "Enclave WSL"), exported as a root file system
# (enclave-wsl.tar.gz) that the Windows app imports with `wsl --import`. See README.md.

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4

# Docker Engine's static build: dockerd, containerd, runc and their helpers. The docker
# command-line tool and ctr are left out; the agent talks to the daemon's socket through socat.
ADD --checksum=sha256:9ac225999fd5e863f7694c728ef23d480616b1e5639328fa309befd4243d69eb \
    https://download.docker.com/linux/static/stable/x86_64/docker-29.9.2.tgz /tmp/docker.tgz

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      iptables=1.8.11-2 \
      ca-certificates=20250419+deb13u1 \
      socat=1.8.0.3-1+deb13u1; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*; \
    tar -xzf /tmp/docker.tgz -C /tmp; \
    for f in dockerd containerd containerd-shim-runc-v2 runc docker-proxy docker-init; do \
      install -m 0755 "/tmp/docker/$f" /usr/local/bin/; \
    done; \
    rm -rf /tmp/docker /tmp/docker.tgz; \
    groupadd --system docker

COPY wsl.conf /etc/wsl.conf
COPY daemon.json /etc/docker/daemon.json
COPY enclave-boot /usr/local/sbin/enclave-boot
RUN chmod 0755 /usr/local/sbin/enclave-boot && echo "enclave-wsl" > /etc/enclave-wsl-release

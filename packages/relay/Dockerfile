# The Enclave relay's image: the bundled relay and the built phone app, on Node 24.
# Build from the repo root (deploy/relay/compose.yaml does):
#   docker build -f packages/relay/Dockerfile -t enclave-relay:0.1.0 .

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/mobile/package.json packages/mobile/
RUN npx --yes pnpm@12.15.0 install --frozen-lockfile \
      --filter @enclave/relay... --filter @enclave/mobile...
COPY packages/shared packages/shared
COPY packages/relay packages/relay
COPY packages/mobile packages/mobile
RUN npx --yes pnpm@12.15.0 exec tsc -b packages/shared \
    && node packages/relay/build.mjs \
    && node packages/mobile/build.mjs

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446
ENV NODE_ENV=production \
    RELAY_HOST=0.0.0.0 \
    RELAY_PORT=8790 \
    RELAY_DATA=/data \
    RELAY_STATIC_DIR=/app/mobile
COPY --from=build /src/packages/relay/dist-bundle/relay.mjs /app/relay.mjs
COPY --from=build /src/packages/mobile/dist /app/mobile
RUN install -d -o node -g node -m 0700 /data
USER node
EXPOSE 8790
CMD ["node", "/app/relay.mjs"]

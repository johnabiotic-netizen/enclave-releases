// The browser image the installed app uses: published by enclave-camoufox's "Enclave image"
// workflow (run 41343173910, tag 2026.11.01) and pinned by digest, so every PC runs exactly
// this image. Setup downloads it on a PC that doesn't have it. A developer run keeps the
// locally built enclave-browser:dev (or ENCLAVE_IMAGE from the repo's .env).
export const BROWSER_IMAGE =
  'ghcr.io/johnabiotic-netizen/enclave-browser@sha256:3506fdefd4e259a5449a6f31d96c803766d97ed0ba112579940a30a21eb57347';

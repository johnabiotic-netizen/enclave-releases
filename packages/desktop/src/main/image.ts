// The browser image the installed app uses, pinned by digest so every PC runs exactly this
// image (tag 2026.11.17, the renamed internals: /opt/session, SESSION_* and the rest). Setup
// downloads it on a PC that doesn't have it. A developer run keeps the locally built
// enclave-browser:dev (or ENCLAVE_IMAGE from the repo's .env).
export const BROWSER_IMAGE =
  'ghcr.io/johnabiotic-netizen/enclave-browser@sha256:4e270b506368b13b8ff7a56bc34686b3aef5eff0e8b7ee31dafd282328b6253a';

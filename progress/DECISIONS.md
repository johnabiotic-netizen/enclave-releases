# Decision log

One entry per real decision. Newest at the top. Keep each to a few lines: context, decision, reason. Record here whenever you deviate from a spec because reality differed, or when you make a choice the docs left open.

Format:
```
## YYYY-MM-DD  Short title
Context: ...
Decision: ...
Reason: ...
```

---

## 2026-10-25  Node 24 LTS instead of Node 20
Context: Docs say Node 20 LTS. Node 20 reached end of life in April 2026; the owner's PC has Node 24.14.1.
Decision: Target Node 24 LTS (`engines: >=24 <25`). Agent and relay use it; Electron (Stage 5) brings its own Node.
Reason: Node 20 no longer gets security fixes. Node 24 is the active LTS line and is already installed.

## 2026-10-25  pnpm through corepack, pinned
Context: pnpm is not installed on the owner's PC.
Decision: Root `package.json` pins `"packageManager": "pnpm@12.15.0"`. Run it as `corepack pnpm <cmd>` (or run `corepack enable` once in an admin PowerShell, then plain `pnpm`).
Reason: No global install needed, and everyone gets the same pnpm version.

## 2026-10-25  Tooling versions for task A
Context: CLAUDE.md requires exact pins. TypeScript 7.0 (the native Go compiler) is out, but typescript-eslint 8.72.0 only supports TypeScript `<6.1`.
Decision: TypeScript 6.0.3, ESLint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.72.0, eslint-config-prettier 10.1.8, Prettier 3.9.10, Vitest 5.0.5, globals 17.13.0, @types/node 24.19.2. Move to TypeScript 7 once typescript-eslint supports it.
Reason: Lint must work. TypeScript 6.0 is the newest version every tool supports.

## 2026-10-25  `@enclave/shared` builds to dist with project references
Context: Consumers include the agent (plain Node), Electron and Vite apps. Node won't strip types inside node_modules, so it can't run `.ts` files from a workspace package.
Decision: `packages/shared` is ESM and compiled by `tsc -b` to `dist/`. Other packages reference it as a TypeScript project reference. `src/contract.test.ts` checks the shared enums against `specs/schemas/profile.schema.json`.
Reason: Works the same for every consumer without extra loaders. The test catches drift between the types and the schema.

## 2026-10-25  Agent API gaps filled
Context: `specs/agent-api.md` did not define the shape of `ram` in `/system` or how DELETE passes its confirm flag.
Decision: `ram` is `{ totalBytes, freeBytes }`. DELETE requires the query `?confirm=true`. The spec is updated to match.
Reason: Simplest shapes. A query flag also works with clients that drop DELETE bodies.

## 2026-10-25  Initial architecture locked
Context: Choosing how PC-to-phone continuity works.
Decision: Profiles run in Docker on the user's PC; phone and PC are both viewers of the one running browser. No profile-data sync between devices.
Reason: Avoids the fingerprint mismatch of syncing a desktop profile onto a mobile browser, keeps running cost near zero, and makes continuity exact (nothing to desync).

## 2026-10-25  Engine choice: Camoufox
Context: Need engine-level fingerprinting without patching Chromium.
Decision: Use Camoufox (Firefox based) as the browser engine.
Reason: Open source, engine-level spoofing, built-in realistic fingerprint generation. Present all profiles as Windows Firefox to avoid engine/UA mismatch.

## 2026-10-25  Streaming: neko v3
Context: Need to view the container browser on PC and phone.
Decision: Build the browser image on neko v3's base image.
Reason: Self-hosted WebRTC streaming, low latency, audio, works in phone browsers; permissive license.

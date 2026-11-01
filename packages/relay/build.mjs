// Bundles the relay into one file (dist-bundle/relay.mjs) for its container image: no
// node_modules to ship. ws's optional native helpers stay out (it works without them).

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/main.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist-bundle/relay.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['bufferutil', 'utf-8-validate'],
  // Some bundled packages use require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __enclaveRequire } from 'node:module'; const require = __enclaveRequire(import.meta.url);",
  },
  legalComments: 'eof',
});

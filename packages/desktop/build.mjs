// Builds the Windows app into dist/: the main process (with the agent inside), the preload
// bridge, and the renderer (React, built by Vite).

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
rmSync(here('./dist/'), { recursive: true, force: true });

// Main process: an ES module for Node 24 (Electron 45). Packages stay external and load from
// node_modules, the agent included.
await esbuild({
  entryPoints: [here('./src/main/main.ts')],
  outfile: here('./dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
});

// Preload: a sandboxed preload must be CommonJS.
await esbuild({
  entryPoints: [here('./src/main/preload.ts')],
  outfile: here('./dist/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
});

await vite({
  configFile: false,
  root: here('./src/renderer/'),
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: {
    outDir: here('./dist/renderer/'),
    emptyOutDir: true,
    target: 'chrome150',
    sourcemap: true,
  },
});

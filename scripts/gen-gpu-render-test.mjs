// Writes packages/agent/src/gpu-render-test.ts from images/browser/gpu_render_test.py, the
// one source of the GPU drawing test (the agent sends it into a one-off container, so a new
// browser image isn't needed for it). Run after changing the .py:
//   node scripts/gen-gpu-render-test.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('images/browser/gpu_render_test.py', root), 'utf8');
const ts =
  '// Generated from images/browser/gpu_render_test.py by scripts/gen-gpu-render-test.mjs\n' +
  '// (gpu-render-test.test.ts checks they match).\n' +
  `export const GPU_RENDER_TEST = ${JSON.stringify(source)};\n`;
writeFileSync(new URL('packages/agent/src/gpu-render-test.ts', root), ts);
console.log('wrote packages/agent/src/gpu-render-test.ts');

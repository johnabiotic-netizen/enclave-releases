// Builds the Windows app into dist/: the main process (with the agent inside), the preload
// bridge, and the renderer (React, built by Vite).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
rmSync(here('./dist/'), { recursive: true, force: true });

// Main process: one ES module for Node 24 (Electron 45) with the agent and every package in
// it, so the installed app needs no node_modules. Native add-ons are optional in the packages
// that mention them (ssh2's crypto, cpu-features) and stay out.
await esbuild({
  entryPoints: [here('./src/main/main.ts')],
  outfile: here('./dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron', 'cpu-features', '*.node'],
  // CommonJS packages inside an ES module still need require, __filename and __dirname.
  banner: {
    js: [
      "import { createRequire as __enclaveRequire } from 'node:module';",
      "import { fileURLToPath as __enclaveToPath } from 'node:url';",
      'const require = __enclaveRequire(import.meta.url);',
      'const __filename = __enclaveToPath(import.meta.url);',
      "const __dirname = __filename.replace(/[\\/][^\\/]*$/, '');",
    ].join(String.fromCharCode(10)),
  },
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

// The app icon (tray and window), drawn here so no binary files live in the repo: the sealed
// cell, a light ring in a dark rounded square, as the phone app's icon.
mkdirSync(here('./dist/'), { recursive: true });
writeFileSync(here('./dist/icon.png'), icon(256));
writeFileSync(here('./dist/tray.png'), icon(32));
writeFileSync(
  here('./dist/icon.ico'),
  ico([16, 24, 32, 48, 64, 128, 256].map((n) => [n, icon(n)])),
);

function icon(size) {
  const bg = [0x16, 0x1a, 0x22];
  const fg = [0xe8, 0xec, 0xf2];
  const rows = [];
  const c = (size - 1) / 2;
  const radius = size * 0.18;
  const outer = size * 0.3;
  const inner = size * 0.19;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
      const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      const d = Math.hypot(x - c, y - c);
      const ring = d <= outer && d >= inner;
      const [r, g, b] = ring ? fg : bg;
      row.set([r, g, b, inside ? 255 : 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A Windows .ico holding PNG images (allowed since Windows Vista). */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(([size, png]) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map(([, png]) => png)]);
}

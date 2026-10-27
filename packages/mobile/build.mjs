// Builds the phone app into dist/: the bundled script, the static files, and the
// home-screen icons (drawn here, so no binary files live in the repo).

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';

const out = new URL('./dist/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('./src/main.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./app.js', out)),
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome110', 'safari16'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
});

cpSync(new URL('./static/', import.meta.url), out, { recursive: true });
for (const size of [192, 512]) writeFileSync(new URL(`./icon-${size}.png`, out), icon(size));

/** A dark rounded square with a light ring: the app icon, as a PNG. */
function icon(size) {
  const bg = [0x16, 0x1a, 0x22];
  const fg = [0xe8, 0xec, 0xf2];
  const rows = [];
  const c = (size - 1) / 2;
  const radius = size * 0.18;
  const outer = size * 0.3;
  const inner = size * 0.19;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
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
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
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

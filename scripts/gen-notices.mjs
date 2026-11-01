// Writes packages/desktop/notices/THIRD_PARTY_LICENSES.txt: every npm package the Windows app
// ships (bundled into main.js, the renderer or the phone app), with its license text.
// Run after changing dependencies:  node scripts/gen-notices.mjs
// The browser image's components are listed by hand in THIRD_PARTY_NOTICES.md.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runtime packages each workspace package ships. Build tools (vite, esbuild, electron-builder,
// playwright, types) are not shipped and stay out.
const roots = {
  'packages/agent': ['dockerode', 'fastify', 'qrcode-generator'],
  'packages/desktop': [
    'electron',
    'react',
    'react-dom',
    '@fontsource-variable/inter',
    '@fontsource/ibm-plex-mono',
    'flag-icons',
    '@m1k1o/neko',
  ],
  'packages/mobile': ['@m1k1o/neko'],
};

const found = new Map(); // "name@version" -> { name, version, license, text, dir }

function pkgDir(fromDir, name) {
  const req = createRequire(join(fromDir, 'package.json'));
  try {
    return dirname(req.resolve(`${name}/package.json`));
  } catch {
    // Packages whose "exports" hide package.json: walk up node_modules by hand.
    let d = fromDir;
    for (;;) {
      const c = join(d, 'node_modules', name);
      if (existsSync(join(c, 'package.json'))) return c;
      const up = dirname(d);
      if (up === d) return null;
      d = up;
    }
  }
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f));
  const texts = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  return file ? texts.join('\n\n') : null;
}

function visit(fromDir, name, optional) {
  const dir = pkgDir(fromDir, name);
  if (!dir) {
    if (!optional) throw new Error(`Can't find ${name} from ${fromDir}`);
    return;
  }
  const real = realpathSync(dir);
  const pj = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
  const key = `${pj.name}@${pj.version}`;
  if (found.has(key)) return;
  const license =
    typeof pj.license === 'string'
      ? pj.license
      : (pj.license?.type ?? pj.licenses?.map((l) => l.type).join(' OR ') ?? 'UNKNOWN');
  const author = typeof pj.author === 'string' ? pj.author : pj.author?.name;
  found.set(key, { name: pj.name, version: pj.version, license, author, text: licenseText(real) });
  // Electron's npm dependencies only download Electron at build time and are not shipped. Its
  // own license sits in dist/; electron-builder also installs LICENSES.chromium.html beside
  // Enclave.exe, which covers Chromium.
  if (pj.name === 'electron') {
    found.get(key).text = readFileSync(join(real, 'dist', 'LICENSE'), 'utf8').trim();
    return;
  }
  for (const dep of Object.keys(pj.dependencies ?? {})) visit(real, dep, false);
  for (const dep of Object.keys(pj.optionalDependencies ?? {})) visit(real, dep, true);
}

for (const [ws, names] of Object.entries(roots)) {
  for (const n of names) visit(join(root, ws), n, false);
}

const list = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));

// A few packages declare a license but ship no license file: use that license's standard text.
const apache = list.find((p) => p.license === 'Apache-2.0' && /Apache License/.test(p.text ?? ''));
const templates = {
  MIT: (who) =>
    `Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (who) =>
    `Copyright (c) ${who}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'Apache-2.0': () => apache?.text ?? null,
};
for (const p of list) {
  if (!p.text && templates[p.license]) {
    const t = templates[p.license](p.author ?? `the ${p.name} authors`);
    if (t)
      p.text = `(No license file ships with this package; the standard ${p.license} text follows.)

${t}`;
  }
}
const missing = list.filter((p) => !p.text);
const unknown = list.filter((p) => p.license === 'UNKNOWN');

const out = [
  'Enclave: third party software in the Windows app and the phone app',
  '',
  'Enclave includes the open source packages below. Each is listed with its version and',
  'license, followed by the license text its authors ship. The browser that runs each profile',
  '(Camoufox, based on Firefox) and the other parts of the browser image are listed in',
  'THIRD_PARTY_NOTICES.md beside this file.',
  '',
  ...list.map((p) => `  ${p.name} ${p.version} (${p.license})`),
  '',
  ...list.flatMap((p) => [
    '='.repeat(78),
    `${p.name} ${p.version}`,
    `License: ${p.license}`,
    '-'.repeat(78),
    p.text ??
      `No license file is shipped with this package. Its package.json declares ${p.license}.`,
    '',
  ]),
].join('\n');

const outDir = join(root, 'packages/desktop/notices');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'THIRD_PARTY_LICENSES.txt'), out);
console.log(`${list.length} packages written to packages/desktop/notices/THIRD_PARTY_LICENSES.txt`);
const licenses = {};
for (const p of list) licenses[p.license] = (licenses[p.license] ?? 0) + 1;
console.log('Licenses:', JSON.stringify(licenses));
if (missing.length)
  console.log('No license file:', missing.map((p) => `${p.name}@${p.version}`).join(', '));
if (unknown.length) console.log('No license declared:', unknown.map((p) => p.name).join(', '));

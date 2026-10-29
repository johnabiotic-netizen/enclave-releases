// Save or check a profile's fingerprint baseline (testing/fingerprint-checklist.md).
//
//   node --env-file=.env scripts/fingerprint/baseline.mjs <profile id or prefix> [--save]
//
// The profile must be running. Opens probe.html in the profile's browser (through the
// stream's control API, like a viewer would), copies the result out of the container and
// writes it to profiles/<id>/baselines/. The first run, or --save, makes it baseline.json;
// later runs are compared with it, the canvas excepted: Firefox Strict renews it on every
// browser start, so only its stability within the run is checked. Exits 1 on a difference.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , idArg, flag] = process.argv;
if (!idArg) {
  console.error(
    'Usage: node --env-file=.env scripts/fingerprint/baseline.mjs <profile id> [--save]',
  );
  process.exit(2);
}

const home =
  process.env.ENCLAVE_HOME ||
  path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'Enclave');
const profilesDir = path.join(home, 'profiles');
const id = readdirSync(profilesDir).find((d) => d.startsWith(idArg));
if (!id) throw new Error(`No profile starts with "${idArg}".`);
const dir = path.join(profilesDir, id);
const profile = JSON.parse(readFileSync(path.join(dir, 'profile.json'), 'utf8'));
const stream = JSON.parse(readFileSync(path.join(dir, 'secrets.json'), 'utf8')).stream;
const container = `enclave-${id}`;

// Docker Desktop puts docker on PATH; on a PC with Docker Engine in WSL it runs there.
const distro = process.env.ENCLAVE_WSL_DISTRO;
const docker = (args, input) =>
  execFileSync(
    distro ? 'wsl.exe' : 'docker',
    distro ? ['-d', distro, '-u', 'root', '--', 'docker', ...args] : args,
    {
      input,
      encoding: 'utf8',
    },
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${profile.status.streamPort}`;
const login = async (password) => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'baseline', password }),
  });
  if (!res.ok)
    throw new Error(`Could not log in to the profile's screen (${res.status}). Is it running?`);
  return res.json();
};

// 1. Put the probe page in the container, clear any earlier result.
const probe = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'images',
    'browser',
    'audit',
    'probe.html',
  ),
  'utf8',
);
docker(
  [
    'exec',
    '-i',
    container,
    'sh',
    '-c',
    'cat > /tmp/enclave-probe.html && chmod 644 /tmp/enclave-probe.html',
  ],
  probe,
);
docker(['exec', container, 'sh', '-c', 'rm -f /data/downloads/enclave-baseline*.json']);

// 2. Open it in a new tab: Ctrl+T, type the address, Enter.
const user = await login(stream.userPassword);
const ws = new WebSocket(`ws://127.0.0.1:${profile.status.streamPort}/api/ws?token=${user.token}`);
await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
const send = (event, payload) => ws.send(JSON.stringify(payload ? { event, payload } : { event }));
const key = async (k) => {
  send('control/keydown', { keysym: k });
  await sleep(25);
  send('control/keyup', { keysym: k });
  await sleep(25);
};
await sleep(800);
send('control/request');
await sleep(800);
send('control/keydown', { keysym: 0xffe3 });
await key(0x74);
send('control/keyup', { keysym: 0xffe3 });
await sleep(800);
for (const c of 'file:///tmp/enclave-probe.html') await key(c.charCodeAt(0));
await key(0xff0d);

// 3. Wait for the download.
let text = '';
for (let i = 0; i < 40 && !text; i++) {
  await sleep(1000);
  text = docker([
    'exec',
    container,
    'sh',
    '-c',
    'cat /data/downloads/enclave-baseline.json 2>/dev/null || true',
  ]);
}
// Close the probe tab and give control back.
send('control/keydown', { keysym: 0xffe3 });
await key(0x77);
send('control/keyup', { keysym: 0xffe3 });
await sleep(300);
send('control/release');
ws.close();
docker([
  'exec',
  container,
  'sh',
  '-c',
  'rm -f /data/downloads/enclave-baseline*.json /tmp/enclave-probe.html',
]);
if (!text) throw new Error('The probe page gave no result within 40 seconds.');

// 4. Save and compare.
const result = JSON.parse(text);
const baselines = path.join(dir, 'baselines');
mkdirSync(baselines, { recursive: true });
const baselineFile = path.join(baselines, 'baseline.json');
const stamp = result.takenAt.replace(/[:.]/g, '-');
writeFileSync(path.join(baselines, `run-${stamp}.json`), text);

const problems = [];
if (result.canvas.first !== result.canvas.second)
  problems.push('canvas changed within one page load');

if (flag === '--save' || !existsSync(baselineFile)) {
  writeFileSync(baselineFile, text);
  console.log(`Saved the baseline for "${profile.name}" in ${baselineFile}.`);
} else {
  const saved = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const flat = (o, p = '') =>
    Object.entries(o ?? {}).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? flat(v, `${p}${k}.`)
        : [[`${p}${k}`, JSON.stringify(v)]],
    );
  const skip = (k) => k === 'takenAt' || k.startsWith('canvas.');
  const now = new Map(flat(result));
  for (const [k, v] of flat(saved)) {
    if (!skip(k) && now.get(k) !== v) problems.push(`${k}: was ${v}, now ${now.get(k)}`);
  }
  if (!problems.length) console.log(`"${profile.name}" matches its baseline (canvas excepted).`);
}

for (const p of problems) console.log(`Different: ${p}`);
process.exit(problems.length ? 1 : 0);

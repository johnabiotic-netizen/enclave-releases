// Test-only: a simulated phone for phone linking through the Enclave relay (Stage 6). Edge
// (headless, fake camera and mic) opens the pairing link from the Windows app, waits until
// the phone is paired, starts or opens the named profile, and reports whether the stream
// plays and how WebRTC connected (direct, or relayed through TURN). Never point it at a real
// account's profile.
//
//   node scripts/phone/sim/relay-sim.mjs <pairing link | relay url> <profile name> [seconds]
//
// With a relay url (no #pair=), it reuses PROFILE_DIR from an earlier run (paired already).
// Env: EDGE_PATH, PROFILE_DIR (Edge's data folder, kept between runs), RELAY_ONLY=1 (the phone
// may use only TURN: a phone on a network that blocks direct connections), TCP_ONLY=1 (TURN
// over TCP only: a network that blocks UDP), SHOT=<file.png>.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [, , start, name, seconds = '40'] = process.argv;
if (!start || !name) {
  console.error('Usage: relay-sim.mjs <pairing link | relay url> <profile name> [seconds]');
  process.exit(2);
}
const edge =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9400 + Math.floor(Math.random() * 500);
const dir = process.env.PROFILE_DIR ?? mkdtempSync(path.join(tmpdir(), 'enclave-relay-sim-'));
const proc = spawn(edge, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${dir}`,
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--window-size=412,915',
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    // Edge is still starting
  }
}
if (!target) throw new Error('Edge did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  if (msg.method === 'Runtime.consoleAPICalled') {
    log('console:', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    log(
      'exception:',
      msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
    );
  }
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};

await cdp('Runtime.enable');
await cdp('Page.enable');
// Keep every WebRTC connection the app makes, to read how it connected; optionally make the
// phone a TURN-only (or TCP-only) client, as on a network that blocks the rest.
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const Real = window.RTCPeerConnection;
    window.__pcs = [];
    const relayOnly = ${process.env.RELAY_ONLY === '1' || process.env.TCP_ONLY === '1'};
    const tcpOnly = ${process.env.TCP_ONLY === '1'};
    window.RTCPeerConnection = function (config) {
      config = { ...config };
      if (relayOnly) config.iceTransportPolicy = 'relay';
      if (tcpOnly) config.iceServers = (config.iceServers || []).map((s) => ({
        ...s, urls: [].concat(s.urls).filter((u) => u.includes('transport=tcp')) }))
        .filter((s) => s.urls.length);
      const pc = new Real(config);
      window.__pcs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Real.prototype;
    window.RTCPeerConnection.generateCertificate = Real.generateCertificate.bind(Real);
  })();`,
});
await cdp('Page.navigate', { url: start });

const text = () => evaluate('document.getElementById("home")?.innerText ?? ""');
const until = async (what, test, ms = 60_000) => {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = await text();
    if (test(last)) return last;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}. Screen: ${last}`);
};

try {
  await until('the profile list', (t) => t.includes(name), 90_000);
  log('paired; profile list shows', JSON.stringify(name));
  const button = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.innerText.includes(${JSON.stringify(name)}));
    const b = card && [...card.querySelectorAll('button')].find((b) => /^(Open|Start)$/.test(b.textContent));
    if (!b) return null;
    b.click();
    return b.textContent;
  })()`);
  log('tapped', button);
  const t0 = Date.now();
  let playing = false;
  while (Date.now() - t0 < 120_000) {
    const v = await evaluate(`(() => {
      const v = document.querySelector('#stage video');
      return v ? { w: v.videoWidth, paused: v.paused, t: v.currentTime } : null;
    })()`);
    if (v && v.w > 0 && !v.paused && v.t > 0) {
      log(`stream plays: ${v.w} wide, after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      playing = true;
      break;
    }
    await sleep(500);
  }
  if (!playing) throw new Error('The stream did not play.');
  const end = Date.now() + Number(seconds) * 1000;
  let frames = 0;
  while (Date.now() < end) {
    await sleep(5000);
    const s = await evaluate(`(async () => {
      const pc = window.__pcs.at(-1);
      if (!pc) return null;
      const stats = await pc.getStats();
      let pair, local, remote, video;
      stats.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        if (r.type === 'inbound-rtp' && r.kind === 'video') video = r;
      });
      if (pair) { local = stats.get(pair.localCandidateId); remote = stats.get(pair.remoteCandidateId); }
      return {
        state: pc.connectionState,
        local: local && local.candidateType + '/' + local.protocol + (local.relayProtocol ? '(' + local.relayProtocol + ')' : ''),
        remote: remote && remote.candidateType + '/' + remote.protocol,
        rtt: pair && pair.currentRoundTripTime,
        frames: video && video.framesDecoded,
        fps: video && video.framesPerSecond,
      };
    })()`);
    const open = await evaluate('document.getElementById("viewer").classList.contains("open")');
    log(
      'webrtc',
      JSON.stringify(s),
      open ? '' : `viewer closed; screen: ${(await text()).replace(/\s+/g, ' ')}`,
    );
    frames = s?.frames ?? frames;
  }
  if (process.env.SHOT) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
    log('screenshot', process.env.SHOT);
  }
  log(frames > 0 ? 'PASS' : 'FAIL: no frames decoded');
} catch (e) {
  log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill();
}

// Test-only: a simulated phone. Edge (headless, with Chromium's fake camera and mic) opens the
// real phone app over Tailscale, opens the named running profile and turns Mic and Camera on,
// then runs the steps and logs what it sees. Never point it at a real account's profile.
//
// Usage (repo root, PowerShell or Git Bash):
//   node --env-file=.env scripts/phone/sim/phone-sim.mjs <app url> <profile name> <seconds> [steps]
// <app url> is the agent's phone address (enclave phone prints it). AGENT_TOKEN comes from .env.
// steps: comma list of <step>@<seconds after sharing>. Numbers inside a step are split by '~'.
//   flip, camoff, micoff, share, later, ask, status, vid, livestop     phone app buttons and state
//   cliprd, paste:<text>, pastebtn:<text>, iosclip, copied, tapcopy     clipboard
//   choosefile:<path>                                                   file passthrough
//   layout:<css width>, shot:<name> (PNG in the current folder)         layout
//   inbound, encstats                                                   WebRTC stats
//   rt:~<geometry file>~<seconds>  round trip on the phone clock (CLOCKCAM=1, pages/rt-test.html)
//   tap:x~y, pinch:cx~cy~d0~d1, pan2:x0~y0~x1~y1, dtap2:x~y, view       touch (TOUCH=1)
//   mouse                                   the profile's pointer (needs ENCLAVE_CONTAINER)
// Env: NOSHARE=1 (no Mic/Camera), TOUCH=1, CLOCKCAM=1 / PORTRAITCAM=1 / STALLCAM=1 (test cameras),
//   NO_TWCC=1, EDGE_PATH, ENCLAVE_CONTAINER (enclave-<profile id>), ENCLAVE_WSL_DISTRO (as the agent).
import { spawn, spawnSync } from 'node:child_process';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [, , app, name, seconds = '60', steps = ''] = process.argv;
const edge =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9400 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(path.join(tmpdir(), 'enclave-phone-sim-'));
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
  if (msg.method === 'Runtime.consoleAPICalled')
    log('console:', msg.params.args.map((a) => a.value ?? a.description).join(' '));
};
const cdp = (method, params = {}) =>
  new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expr) => {
  const r = await cdp('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.result?.value;
};

await cdp('Runtime.enable');
await cdp('Page.enable');
if (process.env.TOUCH === '1')
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: fs
    .readFileSync(new URL('./inject.js', import.meta.url), 'utf8')
    .replace('__NO_TWCC__', String(process.env.NO_TWCC === '1')),
});
if (process.env.STALLCAM === '1')
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: fs.readFileSync(new URL('./stallcam.js', import.meta.url), 'utf8'),
  });
if (process.env.PORTRAITCAM === '1')
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: fs.readFileSync(new URL('./portraitcam.js', import.meta.url), 'utf8'),
  });
if (process.env.CLOCKCAM === '1')
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: fs.readFileSync(new URL('./clockcam.js', import.meta.url), 'utf8'),
  });
const stats = () =>
  js(
    `(async () => { const out = []; for (const pc of window.__pcs || []) { const r = await pc.getStats(); r.forEach((x) => { if (x.type === 'outbound-rtp' && x.kind === 'video') out.push({ fps: x.framesPerSecond, enc: x.framesEncoded, sent: x.framesSent, w: x.frameWidth, h: x.frameHeight, ql: x.qualityLimitationReason, kbps: x.bytesSent, codec: x.codecId, pkts: x.packetsSent, hdr: x.headerBytesSent, retx: x.retransmittedPacketsSent, kf: x.keyFramesEncoded, pli: x.pliCount, nack: x.nackCount }); if (x.type === 'media-source' && x.kind === 'video') out.push({ srcfps: x.framesPerSecond, srcframes: x.frames }); if (x.type === 'candidate-pair' && x.nominated) { const l = r.get(x.localCandidateId), rc = r.get(x.remoteCandidateId); out.push({ pair: (l && l.protocol + ' ' + l.candidateType + ' ' + l.address) + ' -> ' + (rc && rc.protocol + ' ' + rc.address + ':' + rc.port), rtt: x.currentRoundTripTime, avail: x.availableOutgoingBitrate }); } if (x.type === 'remote-inbound-rtp' && x.kind === 'video') out.push({ lost: x.packetsLost, fl: x.fractionLost, rrtt: x.roundTripTime }); }); } return JSON.stringify(out); })()`,
  );
await cdp('Browser.grantPermissions', {
  origin: new URL(app).origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
});
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp('Page.navigate', { url: `${app}#pair=${process.env.AGENT_TOKEN}` });
const clickId = (id) =>
  js(
    `(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
  );
const clickText = (text, scope = 'document') =>
  js(
    `(() => { const b = [...${scope}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!b) return false; b.click(); return true; })()`,
  );

// Open the profile from its card.
let opened = false;
for (let i = 0; i < 60 && !opened; i++) {
  await sleep(500);
  opened = await js(
    `(() => { const c = [...document.querySelectorAll('.card')].find((c) => c.querySelector('.name')?.textContent === ${JSON.stringify(name)}); const b = c && [...c.querySelectorAll('button')].find((b) => b.textContent === 'Open'); if (!b) return false; b.click(); return true; })()`,
  );
}
if (!opened) throw new Error(`no running profile named ${name} in the app`);
log('opened', name);
for (let i = 0; i < 60; i++) {
  await sleep(500);
  if (
    await js(
      `document.getElementById('status')?.textContent === '' && document.getElementById('viewer').classList.contains('open')`,
    )
  )
    break;
}
await sleep(1500);
log('status:', await js(`document.getElementById('status')?.textContent`));
if (process.env.NOSHARE !== '1') {
  log('mic clicked:', await clickId('mic'));
  await sleep(1000);
  log('camera clicked:', await clickId('camera'));
}
await sleep(1000);
log(
  'buttons:',
  await js(`[...document.querySelectorAll('button')].map((b) => b.textContent).join(' | ')`),
);
log(
  'preview:',
  await js(
    `(() => { const v = document.getElementById('preview-video'); return v && v.videoWidth + 'x' + v.videoHeight; })()`,
  ),
);

log('SDP', await js(fs.readFileSync(new URL('./sdp.js', import.meta.url), 'utf8')));
const actions = steps ? steps.split(',').map((s) => s.split('@')) : [];
const t0 = Date.now();
for (const [what, at] of actions) {
  await sleep(Math.max(0, Number(at) * 1000 - (Date.now() - t0)));
  if (what === 'flip') log('flip clicked:', await clickText('Flip'));
  if (what === 'camoff') log('camera off:', await clickId('camera'));
  if (what === 'micoff') log('mic off:', await clickId('mic'));
  if (what === 'ask')
    log(
      'ask:',
      await js(
        `(() => { const a = document.getElementById('ask'); return a.hidden ? 'hidden' : document.getElementById('ask-text').textContent; })()`,
      ),
      '| buttons:',
      await js(
        `[...document.querySelectorAll('#bar button')].map((b) => b.getAttribute('aria-label') + (b.classList.contains('live') ? ' [live]' : '')).join(' | ') + ' || live banner: ' + (document.getElementById('live').hidden ? 'hidden' : document.getElementById('live-text').textContent)`,
      ),
    );
  if (what === 'cliprd')
    log(
      'phone clipboard:',
      await js(`navigator.clipboard.readText().catch((e) => 'ERR ' + e.name)`),
    );
  if (what.startsWith('paste:'))
    log(
      'pasted on phone:',
      await js(
        `(() => { const t = document.querySelector('#stage textarea, #stage input'); if (!t) return 'no input'; t.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(what.slice(6))}); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return t.tagName; })()`,
      ),
    );
  if (what.startsWith('layout:')) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: Number(what.slice(7)),
      height: 800,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(300);
    log(
      'layout',
      what.slice(7),
      await js(
        `(() => { const b = document.getElementById('bar'); return JSON.stringify({ bar: [b.clientWidth, b.scrollWidth], buttons: [...b.querySelectorAll('button')].map((x) => x.textContent + ':' + Math.round(x.getBoundingClientRect().width) + '/' + x.scrollWidth) }); })()`,
      ),
    );
  }
  if (what.startsWith('shot:')) {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(what.slice(5) + '.png', Buffer.from(r.result.data, 'base64'));
    log('shot', what.slice(5));
  }
  if (what === 'vid')
    log(
      'stage video:',
      await js(
        `(() => { const v = document.querySelector('#stage video'); return v ? v.videoWidth + 'x' + v.videoHeight + ' t=' + v.currentTime.toFixed(1) + ' paused=' + v.paused : 'none'; })()`,
      ),
    );
  if (what === 'iosclip')
    log(
      'clipboard writes need a tap:',
      await js(
        `(() => { const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (t) => navigator.userActivation.isActive ? w(t) : Promise.reject(new DOMException('no gesture', 'NotAllowedError')); return true; })()`,
      ),
    );
  if (what === 'copied')
    log(
      'copy offer:',
      await js(
        `document.getElementById('copied').hidden ? 'hidden' : document.getElementById('copied').textContent.replace(/\\s+/g, ' ').trim()`,
      ),
    );
  if (what === 'tapcopy') {
    const r = JSON.parse(
      await js(`JSON.stringify(document.getElementById('copy-phone').getBoundingClientRect())`),
    );
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    log('tapped Copy to phone');
  }
  if (what.startsWith('choosefile:')) {
    // What the phone's chooser does after "Choose file": the file lands in the input.
    log('choose file clicked:', await clickId('ask-share'));
    const doc = await cdp('DOM.getDocument', {});
    const q = await cdp('DOM.querySelector', {
      nodeId: doc.result.root.nodeId,
      selector: '#file-input',
    });
    await cdp('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [what.slice(11)] });
    log('file chosen:', what.slice(11));
  }
  if (what === 'status') log('status:', await js(`document.getElementById('status').textContent`));
  if (what.startsWith('rt:')) {
    // Round trip on the phone's clock: barcode out through the camera, back through the screen.
    const [, file, secs] = what.split('~');
    for (let i = 0; i < 60 && !fs.existsSync(file); i++) await sleep(500);
    const geo = JSON.parse(fs.readFileSync(file, 'utf8'));
    log('rt geometry', JSON.stringify(geo));
    log(
      'rt',
      await js(`(async (geo, secs) => {
      const v = document.querySelector('#stage video');
      const sx = v.videoWidth / geo.sw, sy = v.videoHeight / geo.sh;
      const y = Math.round((geo.y + geo.h / 2) * sy);
      const cv = new OffscreenCanvas(v.videoWidth, 1);
      const g = cv.getContext('2d', { willReadFrequently: true });
      const out = [];
      const end = Date.now() + secs * 1000;
      await new Promise((done) => {
        const f = () => {
          g.drawImage(v, 0, y, v.videoWidth, 1, 0, 0, v.videoWidth, 1);
          const px = g.getImageData(0, 0, v.videoWidth, 1).data;
          let t = 0;
          for (let i = 0; i < 24; i++) {
            const x = Math.floor((geo.x + ((i + 0.5) * geo.w) / 24) * sx) * 4;
            t = t * 2 + (px[x] + px[x + 1] + px[x + 2] > 384 ? 1 : 0);
          }
          out.push((Date.now() % 16777216 - t + 16777216) % 16777216);
          if (Date.now() < end) v.requestVideoFrameCallback(f); else done();
        };
        v.requestVideoFrameCallback(f);
      });
      const ok = out.filter((d) => d < 5000).sort((a, b) => a - b);
      const q = (p) => ok[Math.min(ok.length - 1, Math.floor(ok.length * p))];
      return JSON.stringify({ video: v.videoWidth + 'x' + v.videoHeight, row: y, samples: out.length, valid: ok.length, min: ok[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: ok[ok.length - 1] });
    })(${JSON.stringify(geo)}, ${Number(secs)})`),
    );
  }
  if (what === 'inbound')
    log(
      'inbound',
      await js(
        `(async () => { const out = []; for (const pc of window.__pcs || []) { const r = await pc.getStats(); r.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video') out.push({ fps: x.framesPerSecond, w: x.frameWidth, h: x.frameHeight, decoded: x.framesDecoded, dropped: x.framesDropped, jitterMs: Math.round(x.jitter * 1000), jbMs: x.jitterBufferEmittedCount ? Math.round((x.jitterBufferDelay / x.jitterBufferEmittedCount) * 1000) : null, kbps: x.bytesReceived }); }); } return JSON.stringify(out); })()`,
      ),
    );
  if (what === 'encstats')
    log(
      'sender',
      await js(
        `(async () => { const out = []; for (const pc of window.__pcs || []) { const r = await pc.getStats(); r.forEach((x) => { if (x.type === 'outbound-rtp' && x.kind === 'video' && x.framesEncoded) out.push({ encodeMsPerFrame: +((x.totalEncodeTime / x.framesEncoded) * 1000).toFixed(1), sendDelayMsPerPacket: +((x.totalPacketSendDelay / x.packetsSent) * 1000).toFixed(1), fps: x.framesPerSecond, w: x.frameWidth, encoder: x.encoderImplementation }); if (x.type === 'candidate-pair' && x.nominated) out.push({ rttMs: x.currentRoundTripTime * 1000 }); }); } return JSON.stringify(out); })()`,
      ),
    );
  if (what === 'livestop') log('stop sharing:', await clickId('live-stop'));
  if (what.startsWith('pastebtn:')) {
    await js(`navigator.clipboard.writeText(${JSON.stringify(what.slice(9))})`);
    log(
      'paste button:',
      await clickId('paste'),
      await js(`document.getElementById('status').textContent`),
    );
  }
  if (what === 'share') log('share clicked:', await clickText('Share'));
  if (what === 'later') log('not now clicked:', await clickText('Not now'));
  // Touch steps (zoom test). Coordinates are CSS px on the phone; '~' separates numbers.
  const touch = (type, pts) =>
    cdp('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })),
    });
  const nums = (s) => s.split('~').map(Number);
  if (what.startsWith('tap:')) {
    const [x, y] = nums(what.slice(4));
    await touch('touchStart', [[x, y]]);
    await sleep(60);
    await touch('touchEnd', []);
    log('tapped', x, y);
  }
  if (what.startsWith('pinch:')) {
    const [cx, cy, d0, d1] = nums(what.slice(6));
    const at = (d) => [
      [cx - d / 2, cy],
      [cx + d / 2, cy],
    ];
    await touch('touchStart', at(d0));
    for (let i = 1; i <= 12; i++) {
      await sleep(30);
      await touch('touchMove', at(d0 + ((d1 - d0) * i) / 12));
    }
    await touch('touchEnd', []);
    log('pinched', cx, cy, d0, '->', d1);
  }
  if (what.startsWith('pan2:')) {
    const [x0, y0, x1, y1] = nums(what.slice(5));
    const at = (f) => {
      const x = x0 + (x1 - x0) * f,
        y = y0 + (y1 - y0) * f;
      return [
        [x - 50, y],
        [x + 50, y],
      ];
    };
    await touch('touchStart', at(0));
    for (let i = 1; i <= 12; i++) {
      await sleep(30);
      await touch('touchMove', at(i / 12));
    }
    await touch('touchEnd', []);
    log('two-finger drag', x0, y0, '->', x1, y1);
  }
  if (what.startsWith('dtap2:')) {
    const [x, y] = nums(what.slice(6));
    for (let k = 0; k < 2; k++) {
      await touch('touchStart', [
        [x - 40, y],
        [x + 40, y],
      ]);
      await sleep(60);
      await touch('touchEnd', []);
      await sleep(150);
    }
    log('two-finger double tap', x, y);
  }
  if (what === 'view')
    log(
      'view:',
      await js(
        `(() => { const b = document.querySelector('#stage > div'); const r = b.getBoundingClientRect(); return JSON.stringify({ transform: b.style.transform, rect: [r.left, r.top, r.width, r.height].map((v) => +v.toFixed(1)) }); })()`,
      ),
    );
  if (what === 'mouse') {
    const exec = [
      'exec',
      '-u',
      'neko',
      '-e',
      'DISPLAY=:99.0',
      process.env.ENCLAVE_CONTAINER ?? '',
      'xdotool',
      'getmouselocation',
    ];
    const distro = process.env.ENCLAVE_WSL_DISTRO;
    const r = distro
      ? spawnSync('wsl', ['-d', distro, '-u', 'root', 'docker', ...exec], { encoding: 'utf8' })
      : spawnSync('docker', exec, { encoding: 'utf8' });
    log('profile mouse:', (r.stdout || r.stderr || '').trim());
  }
}
while (Date.now() - t0 < Number(seconds) * 1000 - 30000) {
  await sleep(5000);
  log('stats', await stats());
}
await sleep(Math.max(0, Number(seconds) * 1000 - (Date.now() - t0)));
log('done');
ws.close();
spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
process.exit(0);

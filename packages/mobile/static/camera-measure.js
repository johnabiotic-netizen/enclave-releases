// Test-only: what a website can measure about a camera, for comparing Enclave's phone
// camera with a real webcam in real Windows Firefox. 20 s of frames; nothing leaves the
// page (the result is saved as camera-measure.json).
const SECONDS = 20;
const out = document.getElementById('out');
const result = { takenAt: new Date().toISOString(), userAgent: navigator.userAgent };

const dev = (d) => ({
  kind: d.kind,
  label: d.label,
  id: d.deviceId.slice(0, 12),
  group: d.groupId.slice(0, 12),
});
const stats = (xs) => {
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: xs.length,
    mean: +mean.toFixed(3),
    sd: +sd.toFixed(3),
    min: +sorted[0].toFixed(3),
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
  };
};

async function attempt(name, fn) {
  try {
    const s = await fn();
    const t = s.getVideoTracks()[0];
    const r = { name, ok: true, label: t.label, settings: t.getSettings() };
    s.getTracks().forEach((x) => x.stop());
    return r;
  } catch (e) {
    return { name, ok: false, error: `${e.name}: ${e.message}`, constraint: e.constraint };
  }
}

async function frames(stream) {
  const v = document.getElementById('v');
  v.srcObject = stream;
  await v.play();
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const x = c.getContext('2d', { willReadFrequently: true });
  const intervals = [],
    diffs = [],
    lumas = [],
    noise = [];
  let identical = 0,
    black = 0,
    last = null,
    prevT = null,
    count = 0,
    sizes = new Set();
  const end = performance.now() + SECONDS * 1000;
  await new Promise((done) => {
    const tick = (now, meta) => {
      count++;
      sizes.add(`${meta.width}x${meta.height}`);
      if (prevT !== null) intervals.push(now - prevT);
      prevT = now;
      x.drawImage(v, 0, 0, 64, 36);
      const px = x.getImageData(0, 0, 64, 36).data;
      let sum = 0,
        max = 0,
        d = 0,
        n2 = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        sum += l;
        if (l > max) max = l;
        if (last) d += Math.abs(l - last[i / 4]);
        // Local noise: difference to the right-hand neighbour.
        if ((i / 4) % 64 !== 63) n2 += Math.abs(px[i] - px[i + 4]);
      }
      const lum = new Float32Array(px.length / 4);
      for (let i = 0; i < px.length; i += 4) lum[i / 4] = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (last) {
        diffs.push(d / lum.length);
        if (d === 0) identical++;
      }
      if (max < 2) black++;
      lumas.push(sum / lum.length);
      noise.push(n2 / lum.length);
      last = lum;
      if (performance.now() < end) v.requestVideoFrameCallback(tick);
      else done();
    };
    v.requestVideoFrameCallback(tick);
  });
  return {
    frames: count,
    fps: +(count / SECONDS).toFixed(2),
    sizes: [...sizes],
    intervalMs: stats(intervals),
    diffBetweenFrames: stats(diffs),
    identicalFrames: identical,
    blackFrames: black,
    luma: stats(lumas),
    neighbourDiff: stats(noise),
  };
}

(async () => {
  const md = navigator.mediaDevices;
  const step = (t) => (out.textContent += `\n${t}`);
  step('listing devices');
  result.beforePermission = (await md.enumerateDevices()).map(dev);
  step('asking for the camera');
  let stream = await md.getUserMedia({ video: true, audio: false });
  // ?camera=<part of a label> measures that camera (a PC with several).
  const want = new URLSearchParams(location.search).get('camera');
  let pick = {};
  if (want) {
    const cam = (await md.enumerateDevices()).find(
      (d) => d.kind === 'videoinput' && d.label.toLowerCase().includes(want.toLowerCase()),
    );
    if (!cam) throw new Error('no camera called ' + want);
    stream.getTracks().forEach((t) => t.stop());
    pick = { deviceId: { exact: cam.deviceId } };
    stream = await md.getUserMedia({ video: pick, audio: false });
  }
  const track = stream.getVideoTracks()[0];
  step('camera open: ' + track.label);
  result.label = track.label;
  result.settings = track.getSettings();
  result.capabilities = track.getCapabilities ? track.getCapabilities() : null;
  result.constraints = track.getConstraints();
  step('listing devices again');
  result.afterPermission = (await md.enumerateDevices()).map(dev);
  out.textContent = 'measuring frames for ' + SECONDS + ' s';
  result.frames = await frames(stream);
  // A second camera stream while the first is open (another tab or site would do this).
  result.secondStreamWhileOpen = await attempt('second stream while open', () =>
    md.getUserMedia({ video: { ...pick } }),
  );
  track.stop();
  result.after = [
    await attempt('ideal 1280x720', () =>
      md.getUserMedia({ video: { ...pick, width: { ideal: 1280 }, height: { ideal: 720 } } }),
    ),
    await attempt('exact 1920 wide', () =>
      md.getUserMedia({ video: { ...pick, width: { exact: 1920 } } }),
    ),
    await attempt('frameRate exact 60', () =>
      md.getUserMedia({ video: { ...pick, frameRate: { exact: 60 } } }),
    ),
    await attempt('facingMode user', () =>
      md.getUserMedia({ video: { ...pick, facingMode: 'user' } }),
    ),
    await attempt('facingMode exact environment', () =>
      md.getUserMedia({ video: { ...pick, facingMode: { exact: 'environment' } } }),
    ),
  ];
  const text = JSON.stringify(result, null, 2);
  out.textContent = text;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'camera-measure.json';
  a.click();
  document.title = 'done';
})().catch((e) => {
  out.textContent = 'failed: ' + e.name + ': ' + e.message;
  document.title = 'failed';
});

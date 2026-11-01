// Enclave on the phone: lists the PC's profiles through the agent API and opens a running one
// full screen. The browser keeps running on the PC; this is only a screen onto it.
//
// Two ways in. Through the Enclave relay (Stage 6): the relay serves this app, the phone is
// paired by scanning a QR code in the Windows app, and everything goes through an end-to-end
// encrypted tunnel to the PC (relay.ts). Or over Tailscale (Stage 2, docs/setup/tailscale.md):
// the agent serves it, paired once with `enclave phone`.

import { NekoClient, Overlay } from '@m1k1o/neko';
import { MAX_PHONE_FILE_BYTES, parsePairingFragment, RELAY_API_PATH } from '@enclave/shared';
import type {
  ApiError,
  DownloadedFile,
  MediaInUse,
  Profile,
  StartProfileResponse,
  StreamInfo,
} from '@enclave/shared';
import {
  forgetIdentity,
  loadIdentity,
  pair as pairWithPc,
  phoneName,
  RelayLink,
  routeThroughTunnel,
  TUNNEL_ORIGIN,
  type Identity,
} from './relay.js';

const TOKEN_KEY = 'enclave.agentToken';
const home = document.getElementById('home')!;
const viewer = document.getElementById('viewer')!;
const stage = document.getElementById('stage')!;
const statusLine = document.getElementById('status')!;

// ------------------------------------------------------------------ pairing and the agent API

/** Served by the Enclave relay (Stage 6), rather than by the agent over Tailscale. */
const viaRelay = await fetch(`${RELAY_API_PATH}/info`)
  .then(async (r) => r.ok && ((await r.json()) as { name?: string }).name === 'enclave-relay')
  .catch(() => false);

/** Relay mode: the link to the paired PC (null while this phone isn't paired). */
let link: RelayLink | null = null;
/** Relay mode: what the home screen says while there is no link. */
let pairing: { busy: boolean; message: string | null } = { busy: false, message: null };
/** Said once above the profile list (a stream that ended by itself). */
let homeNotice: string | null = null;

if (viaRelay) {
  routeThroughTunnel(() => link);
  // The Windows app's QR code opens <relay>/#pair=<code>.<secret>.<key hash>.
  const fromQr = parsePairingFragment(location.hash);
  if (fromQr) history.replaceState(null, '', location.pathname);
  const saved = await loadIdentity().catch(() => undefined);
  if (fromQr) void pairPhone(fromQr);
  else if (saved) useIdentity(saved);
} else {
  // `enclave phone` shows a QR code for <app>#pair=<token>. Keep the token, drop it from the URL.
  const pair = /^#pair=([\w-]+)$/.exec(location.hash);
  if (pair) {
    localStorage.setItem(TOKEN_KEY, pair[1]!);
    history.replaceState(null, '', location.pathname);
  }
}
const token = () => localStorage.getItem(TOKEN_KEY);

function useIdentity(identity: Identity): void {
  link?.stop();
  const l = new RelayLink(identity);
  link = l;
  l.onState = (state) => {
    if (link !== l) return;
    if (state.kind === 'revoked') {
      l.stop();
      link = null;
      void forgetIdentity().catch(() => {});
      pairing = {
        busy: false,
        message: 'This phone was unpaired on the PC. To use it again, pair it from the PC.',
      };
      closeViewer();
    }
    void refresh();
  };
  l.start();
}

async function pairPhone(qr: NonNullable<ReturnType<typeof parsePairingFragment>>) {
  pairing = { busy: true, message: null };
  void refresh();
  try {
    useIdentity(await pairWithPc(qr, phoneName()));
    pairing = { busy: false, message: null };
  } catch (e) {
    pairing = { busy: false, message: e instanceof Error ? e.message : String(e) };
    // An earlier pairing still works.
    const saved = await loadIdentity().catch(() => undefined);
    if (saved && !link) useIdentity(saved);
  }
  void refresh();
}

class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(method: string, path: string): Promise<T> {
  if (viaRelay) {
    if (!link) throw new AgentError('This phone is not paired with a PC.', 401);
    const res = await link.request(method, `/v1${path}`);
    const text = new TextDecoder().decode(res.body);
    const body = JSON.parse(text || '{}') as T & Partial<ApiError>;
    if (res.status >= 400) {
      const message = body.error?.message ?? `The PC answered HTTP ${res.status}.`;
      throw new AgentError(message, res.status);
    }
    return body;
  }
  const res = await fetch(`/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}` },
  });
  const body = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) {
    throw new AgentError(body.error?.message ?? `The PC answered HTTP ${res.status}.`, res.status);
  }
  return body;
}

// ------------------------------------------------------------------ profile list

let busy: string | null = null;
let lastError: { id: string; message: string } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showUnpaired(message?: string): void {
  home.replaceChildren(
    el('h1', {}, 'Enclave'),
    el('p', {}, message ?? 'This phone is not connected to your PC yet.'),
    el(
      'p',
      { className: 'note' },
      viaRelay
        ? 'On the PC, open Enclave, go to Settings, choose Pair a phone, and scan the QR code with this phone.'
        : 'On the PC, run "enclave phone" and scan the QR code it shows with this phone.',
    ),
  );
}

function showMessage(text: string, note?: string): void {
  home.replaceChildren(
    el('h1', {}, 'Enclave'),
    el('p', {}, text),
    ...(note ? [el('p', { className: 'note' }, note)] : []),
  );
}

async function refresh(): Promise<void> {
  if (viewer.classList.contains('open')) return;
  if (viaRelay) {
    if (pairing.busy) return showMessage('Pairing this phone with your PC.');
    if (!link) return showUnpaired(pairing.message ?? undefined);
    if (link.state.kind !== 'ready') {
      const pc = link.identity.pc.name;
      return link.state.kind === 'connecting'
        ? showMessage(`Connecting to ${pc}.`)
        : showMessage(link.describe());
    }
  } else if (!token()) return showUnpaired();
  let profiles: Profile[];
  try {
    profiles = await api<Profile[]>('GET', '/profiles');
  } catch (e) {
    if (viaRelay) {
      return showMessage(
        link?.state.kind === 'ready'
          ? String(e instanceof Error ? e.message : e)
          : (link?.describe() ?? ''),
      );
    }
    if (e instanceof AgentError && e.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      return showUnpaired('The PC no longer accepts this phone. Pair it again.');
    }
    home.replaceChildren(
      el('h1', {}, 'Enclave'),
      el(
        'p',
        {},
        "Can't reach your PC. Check that it's on, the agent is running, and Tailscale is connected on both devices.",
      ),
    );
    return;
  }
  const cards = profiles.map((p) => profileCard(p));
  // Said once, above the list: a failed new pairing (an earlier one still works), or a stream
  // that ended by itself.
  const notice = pairing.message ?? homeNotice;
  pairing.message = null;
  homeNotice = null;
  home.replaceChildren(
    el('h1', {}, 'Profiles'),
    ...(notice ? [el('div', { className: 'error' }, notice)] : []),
    ...(cards.length
      ? cards
      : [el('p', { className: 'note' }, 'No profiles yet. Create one on the PC.')]),
  );
}

function profileCard(p: Profile): HTMLElement {
  const running = p.status.state === 'running';
  const place = [p.proxy.lastCheck?.exitIp, p.proxy.lastCheck?.country].filter(Boolean).join(', ');
  const working = busy === p.id;
  const actions: HTMLElement[] = running
    ? [
        el(
          'button',
          { className: 'primary', disabled: working, onclick: () => void open(p) },
          'Open',
        ),
        el('button', { disabled: working, onclick: () => void stop(p) }, 'Stop'),
      ]
    : [
        el(
          'button',
          { className: 'primary', disabled: working, onclick: () => void start(p) },
          working ? 'Starting' : 'Start',
        ),
      ];
  const card = el(
    'div',
    { className: 'card' },
    el(
      'div',
      { className: 'row' },
      el(
        'div',
        { className: 'grow' },
        el('div', { className: 'name' }, p.name),
        el(
          'div',
          { className: 'meta' },
          el(
            'span',
            { className: running ? 'state-running' : '' },
            running ? 'Running' : 'Stopped',
          ),
          place ? ` · ${place}` : '',
        ),
      ),
      ...actions,
    ),
  );
  const message = lastError?.id === p.id ? lastError.message : p.status.lastError;
  if (message) card.append(el('div', { className: 'error' }, message));
  return card;
}

async function act(p: Profile, work: () => Promise<void>): Promise<void> {
  busy = p.id;
  lastError = null;
  await refresh();
  try {
    await work();
  } catch (e) {
    lastError = { id: p.id, message: e instanceof Error ? e.message : String(e) };
  } finally {
    busy = null;
    await refresh();
  }
}

const start = (p: Profile) =>
  act(p, async () => {
    const { stream } = await api<StartProfileResponse>('POST', `/profiles/${p.id}/start`);
    await openStream(p, stream);
  });

const stop = (p: Profile) =>
  act(p, async () => {
    await api('POST', `/profiles/${p.id}/stop`);
  });

const open = (p: Profile) =>
  act(p, async () => {
    await openStream(p, await api<StreamInfo>('GET', `/profiles/${p.id}/stream`));
  });

// ------------------------------------------------------------------ the viewer

let client: NekoClient | null = null;
/** The phone microphone the profile is hearing, while it is shared (Stage 4). */
let mic: { stream: MediaStream; stop: (() => void) | null } | null = null;
/** The phone camera the profile is seeing, while it is shared (Stage 4). */
let camera: {
  /** The phone camera itself; the preview plays it. */
  source: MediaStream;
  /** What the profile gets: the camera framed as a 16:9 webcam. */
  stream: MediaStream;
  /** Stops the framing and the phone camera itself. */
  end: () => void;
  stop: (() => void) | null;
  facing: 'user' | 'environment';
} | null = null;
let overlay: Overlay | null = null;
const detach: (() => void)[] = [];

async function openStream(p: Profile, stream: StreamInfo): Promise<void> {
  // Through the relay, the stream server is reached through the tunnel (relay.ts).
  const streamUrl = viaRelay ? `${TUNNEL_ORIGIN}/neko/${p.id}` : stream.phoneUrl;
  if (!streamUrl) {
    throw new Error('Phone access is off on the PC. Turn it on in Enclave, under Settings.');
  }
  closeViewer();
  const c = new NekoClient({ inputMode: 'touch', autoplay: true });
  client = c;
  // The library guesses whether a paste means the phone's text or the profile's newer copy (a
  // desktop Ctrl+V is ambiguous). On the phone a paste is always a deliberate tap on Paste, so
  // its text becomes the profile's clipboard before the paste keystroke.
  c.preparePaste = async (text) => {
    if (!text || text === c.state.control.clipboard?.text) return;
    pasted = text;
    c.send('clipboard/set', { text });
    await new Promise<void>((done) => {
      const off = c.events.on('room.clipboard.updated', () => (off(), done()));
      setTimeout(() => (off(), done()), 500);
    });
  };
  c.setUrl(streamUrl);
  await c.login('phone', stream.password);

  viewer.classList.add('open');
  document.title = `${p.name} · Enclave`;
  const box = el('div');
  box.style.cssText = 'position:relative;width:100%;height:100%';
  stage.replaceChildren(box);
  detach.push(c.transport.attach(box));
  overlay = new Overlay(c);
  detach.push(overlay.attach(box));
  detach.push(attachGestures(box, c));

  // Take control once the stream is up, and say so while it (re)connects.
  let asked = false;
  detach.push(
    c.store.subscribe(
      (s) => s.connection.status,
      (status) => {
        setStatus(status === 'connected' ? '' : 'Connecting to the PC');
        if (status === 'connected' && !asked) {
          asked = true;
          c.request();
        }
        // A reconnect is a new connection: share the microphone again.
        if (status === 'connected' && mic) mic.stop = c.shareMedia(mic.stream);
        if (status === 'connected' && camera) camera.stop = c.shareMedia(camera.stream);
      },
      { fireImmediately: true },
    ),
  );
  c.connect();

  // The stream ended for good (the profile was stopped on the PC, or is no longer shared with
  // this phone): back to the list, saying so, instead of "Connecting" forever.
  detach.push(
    c.events.on('connection.closed', () => {
      if (client !== c) return;
      closeViewer();
      homeNotice = `${p.name} closed on this phone. It was stopped on the PC, it's no longer shared with this phone, or the connection was lost.`;
      void refresh();
    }),
  );

  // Text copied in the profile goes to the phone's clipboard. Where the phone allows that only
  // right after a tap (iPhone), offer a button that does it. Not for the phone's own paste.
  detach.push(
    c.events.on('room.clipboard.updated', (text: string) => {
      if (text === pasted) return;
      navigator.clipboard.writeText(text).then(
        () => offerCopy(null),
        () => offerCopy(text),
      );
    }),
  );

  shown = p;
  knownDownloads = null;
  offerDownload(null);
  const downloadsPoll = window.setInterval(() => void pollDownloads(), DOWNLOADS_POLL_MS);
  void pollDownloads();
  detach.push(() => window.clearInterval(downloadsPoll));
  wanted = { ...NOTHING_WANTED };
  declined = { camera: false, microphone: false, file: false };
  const poll = window.setInterval(() => void pollMedia(), MEDIA_POLL_MS);
  detach.push(() => window.clearInterval(poll));
}

function closeViewer(): void {
  stopMic();
  stopCamera();
  for (const off of detach.splice(0)) off();
  if (client) {
    client.release();
    client.disconnect();
  }
  client = null;
  overlay = null;
  shown = null;
  pasted = null;
  offerCopy(null);
  wanted = { ...NOTHING_WANTED };
  showAsk();
  stage.replaceChildren();
  offerDownload(null);
  files.hidden = true;
  viewer.classList.remove('open');
  document.title = 'Enclave';
}

function setStatus(text: string): void {
  statusLine.textContent = text;
  statusLine.classList.toggle('show', Boolean(text));
}

/**
 * Phone gestures for a desktop browser. The profile is a PC without a touchscreen (its
 * fingerprint says so), so neko's native touch input does nothing there, and its fallback (a
 * held left button) selects text instead of scrolling. Instead: a drag scrolls with the
 * mouse wheel, a tap clicks, a long press right-clicks. Touches are taken before the overlay
 * sees them; the overlay still handles the keyboard.
 *
 * Two fingers zoom the phone's view of the PC screen (pinch) and move around it (drag);
 * tapping twice with two fingers shows the whole screen again. Only the phone's view
 * changes; the profile's screen stays as it is.
 */
function attachGestures(box: HTMLElement, c: NekoClient): () => void {
  const SCROLL_STEP = 40; // CSS px of finger travel per wheel notch
  const TAP_SLOP = 10; // a touch that moves less than this is a tap
  const LONG_PRESS_MS = 600;
  const MAX_ZOOM = 4;
  const TWO_FINGER_TAP_MS = 300; // two fingers down and up within this, without moving
  const DOUBLE_TAP_MS = 400; // between the two two-finger taps
  let start = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0 };
  let carry = { x: 0, y: 0 };
  let dragging = false;
  // Set once a second finger joins; the touch is then a zoom, never a click or a scroll.
  let multi = false;

  // The view: box is scaled by `zoom` from its top left corner and moved by `pan` (CSS px).
  // The overlay letterboxes the box inside the stage with margins, so positions below are
  // in box coordinates: stage coordinates less the box's margins.
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let pinch: {
    dist: number;
    mid: { x: number; y: number };
    zoom: number;
    pan: { x: number; y: number };
    t: number;
    moved: boolean;
  } | null = null;
  let lastTwoFingerTap = -Infinity;
  box.style.transformOrigin = '0 0';
  const showView = () => {
    const area = box.parentElement ?? box;
    // A zoomed picture larger than the stage always covers it (no empty edge to drag into);
    // one still smaller than the stage stays centred.
    const fit = (p: number, margin: number, size: number, room: number) => {
      const s = size * zoom;
      if (s <= room) return (room - s) / 2 - margin;
      return Math.min(-margin, Math.max(room - s - margin, p));
    };
    pan.x = fit(pan.x, box.offsetLeft, box.offsetWidth, area.clientWidth);
    pan.y = fit(pan.y, box.offsetTop, box.offsetHeight, area.clientHeight);
    box.style.transform = zoom === 1 ? '' : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  };
  const resetView = () => {
    zoom = 1;
    pan = { x: 0, y: 0 };
    showView();
  };
  // A turn of the phone changes the stage's shape: start again from the whole screen.
  const resized = new ResizeObserver(resetView);
  resized.observe(box.parentElement ?? box);
  resized.observe(box); // the overlay resizes it when the PC screen changes size

  // Where a finger is on the PC screen. The picture keeps its shape inside the box (black
  // bars at the sides or top and bottom), and the box may be zoomed and moved.
  const remote = (t: Touch) => {
    const r = box.getBoundingClientRect(); // includes the zoom
    const { width, height } = c.state.screen.size;
    const k = Math.min(r.width / width, r.height / height) || 1;
    const left = r.left + (r.width - width * k) / 2;
    const top = r.top + (r.height - height * k) / 2;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), max - 1));
    return { x: clamp((t.clientX - left) / k, width), y: clamp((t.clientY - top) / k, height) };
  };
  const take = (e: TouchEvent) => {
    e.preventDefault(); // no page zoom, no synthetic mouse events
    e.stopPropagation(); // the overlay below never sees the touch
  };
  const twoFingers = (e: TouchEvent) => {
    const a = e.touches[0]!;
    const b = e.touches[1]!;
    const o = (box.parentElement ?? box).getBoundingClientRect();
    return {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
      mid: {
        x: (a.clientX + b.clientX) / 2 - o.left - box.offsetLeft,
        y: (a.clientY + b.clientY) / 2 - o.top - box.offsetTop,
      },
    };
  };

  const onStart = (e: TouchEvent) => {
    take(e);
    if (e.touches.length >= 2) {
      multi = true;
      const f = twoFingers(e);
      pinch = { ...f, zoom, pan: { ...pan }, t: e.timeStamp, moved: false };
      return;
    }
    if (e.touches.length > 1) return;
    multi = false;
    if (!c.controlling) c.request();
    const t = e.changedTouches[0]!;
    start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
    last = { x: t.clientX, y: t.clientY };
    carry = { x: 0, y: 0 };
    dragging = false;
    const p = remote(t);
    c.input.move(p.x, p.y);
  };
  const onMove = (e: TouchEvent) => {
    take(e);
    if (multi) {
      if (!pinch || e.touches.length < 2) return;
      const f = twoFingers(e);
      if (
        !pinch.moved &&
        Math.abs(f.dist - pinch.dist) < TAP_SLOP &&
        Math.hypot(f.mid.x - pinch.mid.x, f.mid.y - pinch.mid.y) < TAP_SLOP
      ) {
        return;
      }
      pinch.moved = true;
      zoom = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom * (f.dist / pinch.dist)));
      // The point that was under the fingers stays under them.
      const px = (pinch.mid.x - pinch.pan.x) / pinch.zoom;
      const py = (pinch.mid.y - pinch.pan.y) / pinch.zoom;
      pan = { x: f.mid.x - px * zoom, y: f.mid.y - py * zoom };
      showView();
      return;
    }
    if (e.touches.length > 1) return;
    const t = e.changedTouches[0]!;
    if (!dragging && Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_SLOP) return;
    dragging = true;
    carry.x += t.clientX - last.x;
    carry.y += t.clientY - last.y;
    last = { x: t.clientX, y: t.clientY };
    // The page follows the finger: moving it up scrolls down.
    const steps = (v: number) => Math.trunc(v / SCROLL_STEP);
    const sx = steps(carry.x);
    const sy = steps(carry.y);
    if (sx || sy) {
      c.input.scroll(-sx, -sy, false);
      carry.x -= sx * SCROLL_STEP;
      carry.y -= sy * SCROLL_STEP;
    }
  };
  const onEnd = (e: TouchEvent) => {
    take(e);
    if (multi) {
      // A quick two-finger tap; two of them show the whole screen again.
      if (
        pinch &&
        e.touches.length === 1 &&
        !pinch.moved &&
        e.timeStamp - pinch.t < TWO_FINGER_TAP_MS
      ) {
        if (e.timeStamp - lastTwoFingerTap < DOUBLE_TAP_MS) {
          resetView();
          lastTwoFingerTap = -Infinity;
        } else {
          lastTwoFingerTap = e.timeStamp;
        }
      }
      if (e.touches.length < 2) pinch = null;
      return; // the zoom ends when the last finger lifts; no click
    }
    if (dragging || e.touches.length > 0) return;
    const button = e.timeStamp - start.t >= LONG_PRESS_MS ? 3 : 1; // X11: 1 left, 3 right
    const p = remote(e.changedTouches[0]!);
    c.input.move(p.x, p.y);
    c.input.button(button, true);
    c.input.button(button, false);
  };

  const opts = { capture: true, passive: false } as const;
  box.addEventListener('touchstart', onStart, opts);
  box.addEventListener('touchmove', onMove, opts);
  box.addEventListener('touchend', onEnd, opts);
  // The phone took the touch away (a system gesture, a call): no click, no zoom left half done.
  const onCancel = (e: TouchEvent) => {
    take(e);
    dragging = true;
    if (e.touches.length < 2) pinch = null;
  };

  box.addEventListener('touchcancel', onCancel, opts);
  return () => {
    resized.disconnect();
    resetView();
    box.removeEventListener('touchstart', onStart, opts);
    box.removeEventListener('touchmove', onMove, opts);
    box.removeEventListener('touchend', onEnd, opts);
    box.removeEventListener('touchcancel', onCancel, opts);
  };
}

// X11 keysyms for the toolbar: what Firefox on Windows uses for back, forward and reload.
const XK = { Alt_L: 0xffe9, Control_L: 0xffe3, Left: 0xff51, Right: 0xff53, F5: 0xffc2, v: 0x76 };

function press(...keys: number[]): void {
  if (!client?.controlling) client?.request();
  for (const k of keys) client?.input.key(k, true);
  for (const k of [...keys].reverse()) client?.input.key(k, false);
}

document.getElementById('back')!.onclick = () => press(XK.Alt_L, XK.Left);
document.getElementById('forward')!.onclick = () => press(XK.Alt_L, XK.Right);
document.getElementById('reload')!.onclick = () => press(XK.F5);
document.getElementById('keyboard')!.onclick = () => overlay?.mobileKeyboardToggle();
// The phone's clipboard into the profile, where the cursor is. The phone may ask first.
document.getElementById('paste')!.onclick = async () => {
  if (!client) return;
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return setStatus(
      'The phone did not allow reading the clipboard. Allow it for this app and try again.',
    );
  }
  if (!text) return setStatus('Nothing to paste. Copy some text on the phone first.');
  if (!client.controlling) client.request();
  await client.preparePaste(text);
  press(XK.Control_L, XK.v);
};
// The phone microphone, shared into the profile: what a site hears when it uses the
// profile's microphone. Only while the button shows it live.
const micButton = document.getElementById('mic')!;

function showMic(): void {
  micButton.classList.toggle('live', Boolean(mic));
  micButton.setAttribute('aria-pressed', String(Boolean(mic)));
  micButton.setAttribute(
    'aria-label',
    mic ? 'Stop sharing the phone microphone' : 'Share the phone microphone',
  );
  showLive();
}

function stopMic(): void {
  if (!mic) return;
  mic.stop?.();
  for (const t of mic.stream.getTracks()) t.stop();
  mic = null;
  showMic();
  showAsk();
}

const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function useMic(stream: MediaStream): void {
  if (!client) return;
  mic = {
    stream,
    stop: client.state.connection.status === 'connected' ? client.shareMedia(stream) : null,
  };
  // The phone (or the user in its settings) can end the capture; follow it.
  for (const t of stream.getTracks()) t.onended = () => stopMic();
  showMic();
  showAsk();
}

micButton.onclick = async () => {
  if (mic) return stopMic();
  if (!client) return;
  try {
    useMic(await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS }));
  } catch {
    setStatus('The phone did not allow the microphone. Allow it for this app and try again.');
  }
};

// The phone camera, shared into the profile: what a site sees when it uses the profile's
// camera. A small preview shows exactly what is being sent, with a front/back switch.
const cameraButton = document.getElementById('camera')!;
const preview = document.getElementById('preview')!;
const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;

function showCamera(): void {
  cameraButton.classList.toggle('live', Boolean(camera));
  cameraButton.setAttribute('aria-pressed', String(Boolean(camera)));
  cameraButton.setAttribute(
    'aria-label',
    camera ? 'Stop sharing the phone camera' : 'Share the phone camera',
  );
  showLive();
  preview.hidden = !camera;
  // The preview plays the camera itself, cut to the same middle 16:9 by CSS; the frames sent
  // are drawn from it, as an element on screen is never paused by the phone.
  if (previewVideo.srcObject !== (camera?.source ?? null)) {
    previewVideo.srcObject = camera?.source ?? null;
  }
  if (camera) void previewVideo.play().catch(() => {});
  // The front camera is shown mirrored, as phones do; the profile gets it unmirrored.
  previewVideo.style.transform = camera?.facing === 'user' ? 'scaleX(-1)' : '';
}

function stopCamera(): void {
  if (!camera) return;
  camera.stop?.();
  camera.end();
  camera = null;
  showCamera();
  showAsk();
}

// 4:3 at 1440 x 1080: phone sensors are 4:3, and asking for 16:9 makes the phone cut the
// sensor first, so an upright phone would lose a quarter of its width before asWebcam crops.
// 1080 wide keeps the middle 16:9 sharp (1080 x 608 from 1080 x 1440).
const cameraConstraints = (facing: 'user' | 'environment') => ({
  facingMode: facing,
  width: { ideal: 1440 },
  height: { ideal: 1080 },
  aspectRatio: { ideal: 4 / 3 },
  frameRate: { ideal: 30 },
});

const WEBCAM_WIDTH = 1280;
const WEBCAM_HEIGHT = 720;

/**
 * The profile's camera is a 16:9 landscape webcam (1280 x 720), and the PC scales whatever
 * arrives to that size. A phone held upright films portrait, which would come out squashed, so
 * the phone sends the middle 16:9 of its picture at 1280 x 720 instead, framed the way a laptop
 * webcam would be. Each camera frame is drawn once, as it arrives, from `video`: the preview,
 * which is on screen (a hidden player can be paused by the phone, and the profile's camera goes
 * black after 2 seconds without frames).
 */
function asWebcam(video: HTMLVideoElement): { stream: MediaStream; end: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = WEBCAM_WIDTH;
  canvas.height = WEBCAM_HEIGHT;
  const g = canvas.getContext('2d', { alpha: false })!;
  const stream = canvas.captureStream();
  let on = true;
  let timer = 0;
  let callback = 0;
  let lastFrame = performance.now();
  const draw = () => {
    if (!on) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      const cropW = Math.min(w, (h * 16) / 9);
      const cropH = Math.min(h, (w * 9) / 16);
      g.drawImage(
        video,
        (w - cropW) / 2,
        (h - cropH) / 2,
        cropW,
        cropH,
        0,
        0,
        WEBCAM_WIDTH,
        WEBCAM_HEIGHT,
      );
      lastFrame = performance.now();
    }
    next();
  };
  const next = () => {
    if ('requestVideoFrameCallback' in video) callback = video.requestVideoFrameCallback(draw);
    else timer = window.setTimeout(draw, 1000 / 30);
  };
  next();
  // If the preview stops anyway (paused by the phone, or its callback lost), start it again.
  const watchdog = window.setInterval(() => {
    if (!on) return;
    if (video.paused) void video.play().catch(() => {});
    if (performance.now() - lastFrame > 1000 && 'requestVideoFrameCallback' in video) {
      video.cancelVideoFrameCallback(callback);
      lastFrame = performance.now();
      next();
    }
  }, 500);
  return {
    stream,
    end: () => {
      on = false;
      window.clearTimeout(timer);
      window.clearInterval(watchdog);
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(callback);
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

function useCamera(source: MediaStream, facing: 'user' | 'environment'): void {
  if (!client) {
    for (const t of source.getTracks()) t.stop();
    return;
  }
  const { stream, end } = asWebcam(previewVideo);
  camera = {
    source,
    stream,
    end: () => {
      end();
      for (const t of source.getTracks()) t.stop();
    },
    facing,
    stop: client.state.connection.status === 'connected' ? client.shareMedia(stream) : null,
  };
  for (const t of source.getTracks()) t.onended = () => stopCamera();
  showCamera();
  showAsk();
}

async function startCamera(facing: 'user' | 'environment'): Promise<void> {
  if (!client) return;
  try {
    useCamera(
      await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(facing) }),
      facing,
    );
  } catch {
    setStatus('The phone did not allow the camera. Allow it for this app and try again.');
  }
}

cameraButton.onclick = async () => {
  if (camera) return stopCamera();
  await startCamera('user');
};

document.getElementById('flip')!.onclick = async () => {
  if (!camera) return;
  const next = camera.facing === 'user' ? 'environment' : 'user';
  stopCamera();
  await startCamera(next);
};

// "Copy to phone", while a copy from the profile hasn't reached the phone's clipboard.
const copied = document.getElementById('copied')!;
let pasted: string | null = null;
let toCopy: string | null = null;
let copiedTimer = 0;

function offerCopy(text: string | null): void {
  toCopy = text;
  copied.hidden = text === null;
  window.clearTimeout(copiedTimer);
  if (text !== null) copiedTimer = window.setTimeout(() => offerCopy(null), 15_000);
}

document.getElementById('copy-phone')!.onclick = async () => {
  if (toCopy === null) return;
  try {
    await navigator.clipboard.writeText(toCopy);
    offerCopy(null);
  } catch {
    offerCopy(null);
    setStatus('The phone did not allow writing the clipboard.');
  }
};

// While the camera or mic is shared, say so and where, with a way to stop both.
const live = document.getElementById('live')!;
const liveText = document.getElementById('live-text')!;

function showLive(): void {
  live.hidden = !(camera || mic);
  const what = camera && mic ? 'Camera and mic' : camera ? 'Camera' : 'Mic';
  liveText.textContent = `${what} live in ${shown?.name ?? 'this profile'}`;
}

document.getElementById('live-stop')!.onclick = () => {
  stopCamera();
  stopMic();
};

// When a page in the profile starts using the camera or microphone and the phone isn't
// sharing it, offer to; when it opens a file picker, offer a file from the phone. "Not now"
// holds until the page lets go (or the picker closes) and asks again.
const MEDIA_POLL_MS = 2000;
const NOTHING_WANTED: MediaInUse = {
  camera: false,
  microphone: false,
  filePicker: false,
  phoneCamera: false,
  phoneMicrophone: false,
};
const ask = document.getElementById('ask')!;
const askText = document.getElementById('ask-text')!;
const askShare = document.getElementById('ask-share')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
let shown: Profile | null = null;
let wanted: MediaInUse = { ...NOTHING_WANTED };
let declined = { camera: false, microphone: false, file: false };
let polling = false;
let sending = false;

const needCamera = () => wanted.camera && !camera && !declined.camera;
const needMic = () => wanted.microphone && !mic && !declined.microphone;
const needFile = () => wanted.filePicker && !declined.file && !sending;

function showAsk(): void {
  // The file picker waits on screen in the profile, so it comes first.
  if (needFile()) {
    ask.hidden = false;
    askText.textContent = 'This page wants a file.';
    askShare.textContent = 'Choose file';
    return;
  }
  const cam = needCamera();
  const mi = needMic();
  ask.hidden = !(cam || mi);
  askText.textContent = `This page wants your ${
    cam && mi ? 'camera and microphone' : cam ? 'camera' : 'microphone'
  }.`;
  askShare.textContent = 'Share';
}

async function pollMedia(): Promise<void> {
  const p = shown;
  if (!p || polling || client?.state.connection.status !== 'connected') return;
  polling = true;
  try {
    const now = await api<MediaInUse>('GET', `/profiles/${p.id}/media`);
    if (shown !== p) return;
    // The page let go: next time it asks, ask again.
    if (!now.camera) declined.camera = false;
    if (!now.microphone) declined.microphone = false;
    if (!now.filePicker) declined.file = false;
    wanted = now;
  } catch {
    // Missed one check; the next one follows in a moment.
  } finally {
    polling = false;
  }
  showAsk();
}

document.getElementById('ask-later')!.onclick = () => {
  if (needFile()) {
    declined.file = true;
    return showAsk();
  }
  if (needCamera()) declined.camera = true;
  if (needMic()) declined.microphone = true;
  showAsk();
};

// One request for both, so the phone asks its permission once and the tap still counts.
askShare.onclick = async () => {
  // The phone's own chooser: take a photo, pick one, or pick any file.
  if (needFile()) return fileInput.click();
  const video = needCamera();
  const audio = needMic();
  if (!client || !(video || audio)) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: video && cameraConstraints('user'),
      audio: audio && MIC_CONSTRAINTS,
    });
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    if (audioTracks.length) useMic(new MediaStream(audioTracks));
    if (videoTracks.length) useCamera(new MediaStream(videoTracks), 'user');
  } catch {
    setStatus(
      `The phone did not allow the ${video && audio ? 'camera and microphone' : video ? 'camera' : 'microphone'}. Allow ${video && audio ? 'them' : 'it'} for this app and try again.`,
    );
  }
};

// The chosen file goes to the PC, which puts it in the profile and picks it in the open picker.
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  const p = shown;
  if (!file || !p) return;
  if (file.size > MAX_PHONE_FILE_BYTES) {
    return setStatus('That file is over 100 MB. Choose a smaller one.');
  }
  sending = true;
  showAsk();
  setStatus(`Sending ${file.name}`);
  try {
    const path = `/v1/profiles/${p.id}/files?name=${encodeURIComponent(file.name)}`;
    let status: number;
    let body: Partial<ApiError>;
    if (viaRelay) {
      if (!link) throw new Error('This phone is not paired with a PC.');
      const res = await link.request('POST', path, {
        body: file,
        contentType: 'application/octet-stream',
      });
      status = res.status;
      body = JSON.parse(new TextDecoder().decode(res.body) || '{}') as Partial<ApiError>;
    } else {
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      status = res.status;
      body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    }
    if (status >= 400) throw new Error(body.error?.message ?? `The PC answered HTTP ${status}.`);
    setStatus('');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
  } finally {
    sending = false;
    // The picker has closed; don't offer it again before the next check says so.
    wanted = { ...wanted, filePicker: false };
    showAsk();
  }
};

// ------------------------------------------------------------------ downloads

// When the profile finishes a download, offer to save it on the phone. The file comes from
// the PC (through the relay's encrypted tunnel, or over Tailscale) and the phone's browser
// saves it, usually to its Downloads folder.
const DOWNLOADS_POLL_MS = 3000;
const got = document.getElementById('got')!;
const gotText = document.getElementById('got-text')!;
const files = document.getElementById('files')!;
const filesList = document.getElementById('files-list')!;
/** Downloads already there (name and time) when the profile was opened or last checked. */
let knownDownloads: Set<string> | null = null;
let offered: DownloadedFile | null = null;
let saving = false;

const downloadKey = (f: DownloadedFile) => `${f.name}\n${f.modifiedAt}`;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function offerDownload(file: DownloadedFile | null): void {
  offered = file;
  got.hidden = !file;
  if (file) gotText.textContent = `Downloaded ${file.name}`;
}

async function pollDownloads(): Promise<void> {
  const p = shown;
  if (!p || client?.state.connection.status !== 'connected') return;
  let list: DownloadedFile[];
  try {
    list = await api<DownloadedFile[]>('GET', `/profiles/${p.id}/downloads`);
  } catch {
    return; // missed one check
  }
  if (shown !== p) return;
  const keys = new Set(list.map(downloadKey));
  // The first look only learns what is there; after that, a new file is offered.
  if (knownDownloads) {
    const fresh = list.find((f) => !knownDownloads!.has(downloadKey(f)));
    if (fresh) offerDownload(fresh);
  }
  knownDownloads = keys;
  if (!files.hidden) showFiles(list);
}

async function saveToPhone(file: DownloadedFile): Promise<void> {
  const p = shown;
  if (!p || saving) return;
  saving = true;
  setStatus(`Saving ${file.name}`);
  const path = `/v1/profiles/${p.id}/downloads/${encodeURIComponent(file.name)}`;
  try {
    let blob: Blob;
    if (viaRelay) {
      if (!link) throw new Error('This phone is not paired with a PC.');
      link.onProgress = (_ch, done, total) =>
        setStatus(`Saving ${file.name}: ${Math.floor((done / Math.max(total, 1)) * 100)}%`);
      const res = await link.request('GET', path);
      if (res.status >= 400) {
        const body = JSON.parse(new TextDecoder().decode(res.body) || '{}') as Partial<ApiError>;
        throw new Error(body.error?.message ?? `The PC answered HTTP ${res.status}.`);
      }
      blob = new Blob([res.body as Uint8Array<ArrayBuffer>]);
    } else {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
        throw new Error(body.error?.message ?? `The PC answered HTTP ${res.status}.`);
      }
      blob = await res.blob();
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus('');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
  } finally {
    if (link) link.onProgress = () => {};
    saving = false;
  }
}

function showFiles(list: DownloadedFile[]): void {
  filesList.replaceChildren(
    ...(list.length
      ? list.map((f) =>
          el(
            'div',
            { className: 'file' },
            el(
              'div',
              {},
              el('div', { className: 'name' }, f.name),
              el('div', { className: 'meta' }, size(f.bytes)),
            ),
            el('button', { onclick: () => void saveToPhone(f) }, 'Save'),
          ),
        )
      : [el('p', { className: 'note' }, 'Nothing downloaded in this profile yet.')]),
  );
}

document.getElementById('got-save')!.onclick = () => {
  const f = offered;
  offerDownload(null);
  if (f) void saveToPhone(f);
};
document.getElementById('got-later')!.onclick = () => offerDownload(null);
document.getElementById('downloads')!.onclick = async () => {
  const p = shown;
  if (!p) return;
  files.hidden = false;
  filesList.replaceChildren(el('p', { className: 'note' }, 'Reading.'));
  try {
    showFiles(await api<DownloadedFile[]>('GET', `/profiles/${p.id}/downloads`));
  } catch (e) {
    filesList.replaceChildren(
      el('p', { className: 'error' }, e instanceof Error ? e.message : String(e)),
    );
  }
};
document.getElementById('files-close')!.onclick = () => {
  files.hidden = true;
};

document.getElementById('close')!.onclick = () => {
  closeViewer();
  void refresh();
};

// After the phone sleeps or changes network the library reconnects by itself; if it gave up
// while the screen was off, start again when the app comes back. The PC session is untouched.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  link?.wake();
  if (client && client.state.connection.status === 'disconnected') client.connect();
  if (!client) void refresh();
});

// ------------------------------------------------------------------ start

if ('serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js');
window.addEventListener('online', () => link?.wake());
void refresh();
window.setInterval(() => void refresh(), 10_000);

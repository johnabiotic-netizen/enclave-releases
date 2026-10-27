// Enclave on the phone (Stage 2): lists the PC's profiles through the agent API and opens a
// running one full screen. The browser keeps running on the PC; this is only a screen onto it.
// Served by the agent over Tailscale (docs/setup/tailscale.md); paired once with `enclave phone`.

import { NekoClient, Overlay } from '@m1k1o/neko';
import type { ApiError, Profile, StartProfileResponse, StreamInfo } from '@enclave/shared';

const TOKEN_KEY = 'enclave.agentToken';
const home = document.getElementById('home')!;
const viewer = document.getElementById('viewer')!;
const stage = document.getElementById('stage')!;
const statusLine = document.getElementById('status')!;

// ------------------------------------------------------------------ pairing and the agent API

// `enclave phone` shows a QR code for <app>#pair=<token>. Keep the token, drop it from the URL.
const pair = /^#pair=([\w-]+)$/.exec(location.hash);
if (pair) {
  localStorage.setItem(TOKEN_KEY, pair[1]!);
  history.replaceState(null, '', location.pathname);
}
const token = () => localStorage.getItem(TOKEN_KEY);

class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api<T>(method: string, path: string): Promise<T> {
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
      'On the PC, run "enclave phone" and scan the QR code it shows with this phone.',
    ),
  );
}

async function refresh(): Promise<void> {
  if (viewer.classList.contains('open')) return;
  if (!token()) return showUnpaired();
  let profiles: Profile[];
  try {
    profiles = await api<Profile[]>('GET', '/profiles');
  } catch (e) {
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
  home.replaceChildren(
    el('h1', {}, 'Profiles'),
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
let overlay: Overlay | null = null;
const detach: (() => void)[] = [];

async function openStream(p: Profile, stream: StreamInfo): Promise<void> {
  if (!stream.phoneUrl) {
    throw new Error('Phone access is off on the PC. Start the agent with ENCLAVE_PHONE=tailscale.');
  }
  closeViewer();
  const c = new NekoClient({ inputMode: 'touch', autoplay: true });
  client = c;
  c.setUrl(stream.phoneUrl);
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
      },
      { fireImmediately: true },
    ),
  );
  c.connect();
}

function closeViewer(): void {
  for (const off of detach.splice(0)) off();
  if (client) {
    client.release();
    client.disconnect();
  }
  client = null;
  overlay = null;
  stage.replaceChildren();
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
 */
function attachGestures(box: HTMLElement, c: NekoClient): () => void {
  const SCROLL_STEP = 40; // CSS px of finger travel per wheel notch
  const TAP_SLOP = 10; // a touch that moves less than this is a tap
  const LONG_PRESS_MS = 600;
  let start = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0 };
  let carry = { x: 0, y: 0 };
  let dragging = false;

  const remote = (t: Touch) => {
    const r = box.getBoundingClientRect();
    const { width, height } = c.state.screen.size;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), max));
    return {
      x: clamp((width / r.width) * (t.clientX - r.left), width),
      y: clamp((height / r.height) * (t.clientY - r.top), height),
    };
  };
  const take = (e: TouchEvent) => {
    e.preventDefault(); // no page zoom, no synthetic mouse events
    e.stopPropagation(); // the overlay below never sees the touch
  };

  const onStart = (e: TouchEvent) => {
    take(e);
    if (e.touches.length > 1) return;
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
  box.addEventListener('touchcancel', take, opts);
  return () => {
    box.removeEventListener('touchstart', onStart, opts);
    box.removeEventListener('touchmove', onMove, opts);
    box.removeEventListener('touchend', onEnd, opts);
    box.removeEventListener('touchcancel', take, opts);
  };
}

// X11 keysyms for the toolbar: what Firefox on Windows uses for back, forward and reload.
const XK = { Alt_L: 0xffe9, Left: 0xff51, Right: 0xff53, F5: 0xffc2 };

function press(...keys: number[]): void {
  if (!client?.controlling) client?.request();
  for (const k of keys) client?.input.key(k, true);
  for (const k of [...keys].reverse()) client?.input.key(k, false);
}

document.getElementById('back')!.onclick = () => press(XK.Alt_L, XK.Left);
document.getElementById('forward')!.onclick = () => press(XK.Alt_L, XK.Right);
document.getElementById('reload')!.onclick = () => press(XK.F5);
document.getElementById('keyboard')!.onclick = () => overlay?.mobileKeyboardToggle();
document.getElementById('close')!.onclick = () => {
  closeViewer();
  void refresh();
};

// After the phone sleeps or changes network the library reconnects by itself; if it gave up
// while the screen was off, start again when the app comes back. The PC session is untouched.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (client && client.state.connection.status === 'disconnected') client.connect();
  if (!client) void refresh();
});

// ------------------------------------------------------------------ start

if ('serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js');
void refresh();
window.setInterval(() => void refresh(), 10_000);

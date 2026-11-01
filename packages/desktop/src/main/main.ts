// Enclave for Windows: the main process. Runs the agent inside the app and gives the window
// a narrow bridge to it (preload.ts). The renderer never sees the agent token.

import { existsSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  safeStorage,
  shell,
  Tray,
} from 'electron';
import { loadConfig, startAgent, type RunningAgent, type SecretSealer } from '@enclave/agent';
import { API_BASE_PATH, DESKTOP_APP_ORIGIN } from '@enclave/shared';
import { SettingsFile, type AppSettings, type PhoneMode } from './settings.js';
import { findWslDocker, runSetupChecks } from './setup.js';
import type {
  AgentReply,
  AgentState,
  AppSettingsChange,
  AppSettingsView,
  SetupCheck,
} from '../shared/bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The app's own data folder holds the key safeStorage encrypts every secret with (Chromium's
// "Local State"). Electron names that folder after the app, so a rename would lose the key and
// with it every saved password. It is fixed here: %APPDATA%\Enclave, whatever the app is called.
app.setPath('userData', path.join(app.getPath('appData'), 'Enclave'));
// Developer runs only: the UI tests start a separate Enclave with its own folders (e2e/).
if (!app.isPackaged && process.env.ENCLAVE_TEST_USER_DATA) {
  app.setPath('userData', process.env.ENCLAVE_TEST_USER_DATA);
}

// A developer run from the repo uses the repo's .env (Docker in WSL, phone mode, test proxy).
const repoEnv = path.resolve(here, '../../../.env');
if (!app.isPackaged && existsSync(repoEnv)) process.loadEnvFile(repoEnv);
// Installed: the phone app and the Windows Firefox reference ship next to the app.
if (app.isPackaged) {
  process.env.ENCLAVE_MOBILE_DIR = path.join(process.resourcesPath, 'mobile');
  process.env.ENCLAVE_REFERENCE_DIR = path.join(process.resourcesPath, 'reference');
}

let agent: RunningAgent | null = null;
let token = '';
/** Enclave's data folder (profiles, app settings). */
let home = '';
/** The agent's configuration from the last start (image name, WSL distro). */
let lastConfig: { image: string; wslDistro: string | undefined } = {
  image: 'enclave-browser:dev',
  wslDistro: undefined,
};
let state: AgentState = { status: 'starting' };
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Set once Quit Enclave runs: the window may close for real then. */
let quitting = false;

// The window's pages come from app://enclave/, a real origin (file:// has none), which neko
// is told to accept (DESKTOP_APP_ORIGIN).
const APP_HOST = new URL(DESKTOP_APP_ORIGIN).host;
const rendererDir = path.join(here, 'renderer');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  void app.whenReady().then(async () => {
    protocol.handle('app', serveRenderer);
    createTray();
    createWindow();
    await bootAgent();
  });
}

/** Files of the built renderer only; anything outside it is not found. */
function serveRenderer(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);
  const file = path.normalize(path.join(rendererDir, decodeURIComponent(url.pathname)));
  if (url.host !== APP_HOST || !file.startsWith(rendererDir + path.sep)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

async function bootAgent(): Promise<void> {
  setState({ status: 'starting' });
  try {
    const base = loadConfig({ ...process.env, AGENT_TOKEN: 'x'.repeat(32) });
    home = base.home;
    const settings = new SettingsFile(home);
    const saved = await settings.read();
    // No Docker Desktop and nothing configured: use the WSL distro that has Docker Engine.
    if (!saved.wslDistro && !process.env.ENCLAVE_WSL_DISTRO && !process.env.DOCKER_HOST) {
      const distro = await findWslDocker();
      if (distro) {
        saved.wslDistro = distro;
        await settings.write(saved);
      }
    }
    await checkEncryption();
    token = await settings.agentToken(process.env.AGENT_TOKEN);
    const config = loadConfig({
      ...process.env,
      AGENT_TOKEN: token,
      ENCLAVE_WSL_DISTRO: saved.wslDistro ?? process.env.ENCLAVE_WSL_DISTRO,
      ENCLAVE_PHONE: phoneSetting(saved),
      ENCLAVE_IDLE_MINUTES: saved.idleMinutes
        ? String(saved.idleMinutes)
        : process.env.ENCLAVE_IDLE_MINUTES,
    });
    lastConfig = { image: config.image, wslDistro: config.wslDistro };
    agent = await startAgent(config, { sealer: safeStorageSealer });
    setState({ status: 'running', dockerMode: agent.dockerMode, phoneApp: agent.phoneApp ?? null });
  } catch (err) {
    setState({ status: 'failed', message: describeStartError(err) });
  }
}

/** The phone mode the service runs with, as the settings screen shows it. */
function phoneMode(saved: AppSettings): PhoneMode {
  const m = phoneSetting(saved);
  return m === 'relay' || m === 'tailscale' ? m : 'off';
}

function phoneSetting(saved: AppSettings): string | undefined {
  if (saved.phone === 'off') return '';
  return saved.phone ?? process.env.ENCLAVE_PHONE;
}

/** Restarts the agent inside the app (settings changed). Running profiles keep running. */
let restarting: Promise<void> | null = null;
function restartAgent(): Promise<void> {
  // One restart at a time; a second request waits for the one under way.
  restarting ??= (async () => {
    const old = agent;
    agent = null;
    setState({ status: 'starting' });
    await old?.close().catch(() => {});
    await bootAgent();
  })().finally(() => (restarting = null));
  return restarting;
}

function describeStartError(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    return 'Another Enclave is already running on this PC (its port is in use). Close it and try again.';
  }
  return e.message || String(err);
}

function setState(next: AgentState): void {
  state = next;
  win?.webContents.send('agent:state', state);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0E1420',
    title: 'Enclave',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(here, 'icon.png'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The viewer plays the profile's sound without a click first.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // The window may notify and use the clipboard (the viewer's copy and paste); nothing else.
  const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write']);
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  win.once('ready-to-show', () => win?.show());
  // The window shows only the app's own pages; links open in the user's own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadURL(`${DESKTOP_APP_ORIGIN}/index.html`);
  // Closing the window keeps Enclave and its profiles running in the tray (DECISIONS
  // 2026-10-31); Quit Enclave in the tray menu ends it.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    void hintTray();
  });
  win.on('closed', () => (win = null));
}

function showWindow(): void {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

// ---------------------------------------------------------------- the bridge

ipcMain.handle('agent:state', () => state);

ipcMain.handle('settings:get', async (): Promise<AppSettingsView> => {
  const file = new SettingsFile(home);
  const saved = await file.read();
  return {
    idleMinutes: saved.idleMinutes ?? (Number(process.env.ENCLAVE_IDLE_MINUTES) || 20),
    defaultProxy: await file.defaultProxy(),
    phone: phoneMode(saved),
    dataFolder: home,
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
      node: process.versions.node,
    },
  };
});

ipcMain.handle('settings:set', async (_e, change: AppSettingsChange) => {
  const file = new SettingsFile(home);
  const saved = await file.read();
  let restart = false;
  if (change.idleMinutes !== undefined) {
    const n = Number(change.idleMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440)
      throw new Error('A whole number from 1 to 1440.');
    restart ||= n !== saved.idleMinutes;
    saved.idleMinutes = n;
  }
  if (change.phone !== undefined) {
    const next = change.phone;
    if (next !== 'relay' && next !== 'tailscale' && next !== 'off') {
      throw new Error('Choose how your phone reaches this PC.');
    }
    restart ||= next !== phoneMode(saved);
    saved.phone = next;
  }
  await file.write(saved);
  if (change.defaultProxy !== undefined) await file.setDefaultProxy(change.defaultProxy.trim());
  if (restart) await restartAgent();
});

ipcMain.handle('setup:check', async (): Promise<SetupCheck[]> => {
  // Recheck after a fix: the service may start now (Docker came up).
  if (!agent) await restartAgent();
  const system = agent ? await agent.service.system().catch(() => null) : null;
  return runSetupChecks({
    dockerOk: system?.dockerOk ?? false,
    imageBuilt: system?.imageBuilt ?? false,
    image: lastConfig.image,
    wslDistro: lastConfig.wslDistro,
    agentError: state.status === 'failed' ? state.message : undefined,
  });
});

ipcMain.handle('app:open-data', async () => {
  if (home) await shell.openPath(home);
});

// A profile's download into this PC's Downloads folder. The file came from a website, so it
// gets Windows' "from the internet" mark (as a browser's downloads do) and is never opened
// by Enclave: opening it is the user's choice, with Windows' own warnings.
ipcMain.handle('downloads:save', async (_e, profileId: unknown, name: unknown) => {
  if (!agent) throw new Error('Enclave is still starting.');
  if (
    typeof profileId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(profileId) ||
    typeof name !== 'string' ||
    !name ||
    name.length > 255
  ) {
    throw new Error('Bad download.');
  }
  const res = await agent.app.inject({
    method: 'GET',
    url: `${API_BASE_PATH}/profiles/${profileId}/downloads/${encodeURIComponent(name)}`,
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.statusCode >= 400) {
    const err = parseBody(res.body) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message ?? `Couldn't get the file (${res.statusCode}).`);
  }
  const dir = app.getPath('downloads');
  const target = await freeName(dir, windowsFileName(name));
  await writeFile(target, res.rawPayload, { flag: 'wx' });
  await writeFile(`${target}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n').catch(() => {});
  return { path: target };
});

ipcMain.handle('downloads:show', (_e, target: unknown) => {
  const dir = app.getPath('downloads');
  if (typeof target === 'string' && path.dirname(target) === dir) shell.showItemInFolder(target);
});

ipcMain.handle('clipboard:write', (_e, text: unknown) => {
  if (typeof text === 'string' && text.length <= 1_000_000) clipboard.writeText(text);
});

ipcMain.handle(
  'agent:request',
  async (_e, method: string, apiPath: string, body?: unknown): Promise<AgentReply> => {
    if (!agent) {
      return {
        status: 503,
        body: { error: { code: 'NOT_READY', message: 'Enclave is still starting.' } },
      };
    }
    if (!/^\/[A-Za-z0-9/_.?=&%-]*$/.test(apiPath)) {
      return { status: 400, body: { error: { code: 'BAD_PATH', message: 'Bad request path.' } } };
    }
    const res = await agent.app.inject({
      method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: `${API_BASE_PATH}${apiPath}`,
      headers: { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: res.statusCode, body: parseBody(res.body) };
  },
);

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------- the tray

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(path.join(here, 'tray.png')));
  tray.setToolTip('Enclave');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Enclave', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Quit Enclave', click: () => void quitAll() },
    ]),
  );
  tray.on('click', () => showWindow());
}

/** The first time the window closes, say where Enclave went. Once per PC. */
async function hintTray(): Promise<void> {
  if (!home) return;
  const settings = new SettingsFile(home);
  const saved = await settings.read();
  if (saved.trayHintShown) return;
  await settings.write({ ...saved, trayHintShown: true });
  new Notification({
    title: 'Enclave is still running',
    body: 'Your profiles keep running, so your phone can still reach them. Quit Enclave from its icon in the taskbar corner.',
    icon: path.join(here, 'icon.png'),
  }).show();
}

app.on('window-all-closed', () => {
  // Hidden to the tray, not quit (see the window's close handler).
});

/** Quit Enclave: stops every running profile cleanly (tabs and logins kept), then exits. */
async function quitAll(): Promise<void> {
  if (quitting) return;
  quitting = true;
  tray?.setToolTip('Enclave is stopping profiles');
  if (agent) {
    const running = (await agent.service.list().catch(() => [])).filter(
      (p) => p.status.state === 'running' || p.status.state === 'starting',
    );
    await Promise.allSettled(running.map((p) => agent!.service.stop(p.id)));
    await agent.close().catch(() => {});
  }
  tray?.destroy();
  app.exit(0);
}

// Developer runs only: tests reach Quit Enclave through the debugger (no tray clicks).
if (!app.isPackaged) {
  Object.assign(globalThis, {
    enclaveDev: {
      quit: quitAll,
      closeWindow: () => win?.close(),
      windows: () =>
        BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), title: w.getTitle() })),
      tray: () => (tray ? !tray.isDestroyed() : false),
    },
  });
}

// Windows ending the session, or app.quit() from elsewhere: the same clean stop.
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  void quitAll();
});

/** Profile passwords on disk, encrypted for this Windows user (DPAPI through safeStorage). */
const safeStorageSealer: SecretSealer = {
  seal: (plain) => safeStorage.encryptStringAsync(plain),
  open: async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result,
};

/** Encryption must read back what it wrote before any password is sealed with it. */
async function checkEncryption(): Promise<void> {
  const probe = `enclave-check-${Date.now()}`;
  const sealed = await safeStorage.encryptStringAsync(probe);
  const { result } = await safeStorage.decryptStringAsync(sealed);
  if (result !== probe || sealed.includes(probe)) {
    throw new Error("Windows could not protect Enclave's secrets for this user.");
  }
}

/** A name Windows accepts: no reserved characters or names, no trailing dot or space. */
function windowsFileName(name: string): string {
  // Control characters are exactly what Windows refuses in a file name.
  // eslint-disable-next-line no-control-regex
  let n = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `_${n}`;
  return n || 'download';
}

/** `name`, or "name (2).ext" and so on if it is taken, in `dir`. */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, i === 1 ? name : `${base} (${i})${ext}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Too many files with that name in Downloads.');
}

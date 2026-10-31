// Enclave for Windows: the main process. Runs the agent inside the app and gives the window
// a narrow bridge to it (preload.ts). The renderer never sees the agent token.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { loadConfig, startAgent, type RunningAgent } from '@enclave/agent';
import { API_BASE_PATH } from '@enclave/shared';
import { SettingsFile } from './settings.js';
import type { AgentReply, AgentState } from '../shared/bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// A developer run from the repo uses the repo's .env (Docker in WSL, phone mode, test proxy).
const repoEnv = path.resolve(here, '../../../.env');
if (!app.isPackaged && existsSync(repoEnv)) process.loadEnvFile(repoEnv);

let agent: RunningAgent | null = null;
let token = '';
let state: AgentState = { status: 'starting' };
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  void app.whenReady().then(async () => {
    createWindow();
    await bootAgent();
  });
}

async function bootAgent(): Promise<void> {
  setState({ status: 'starting' });
  try {
    const base = loadConfig({ ...process.env, AGENT_TOKEN: 'x'.repeat(32) });
    const settings = new SettingsFile(base.home);
    const saved = await settings.read();
    token = await settings.agentToken(process.env.AGENT_TOKEN);
    const config = loadConfig({
      ...process.env,
      AGENT_TOKEN: token,
      ENCLAVE_WSL_DISTRO: saved.wslDistro ?? process.env.ENCLAVE_WSL_DISTRO,
      ENCLAVE_PHONE: saved.phone ?? process.env.ENCLAVE_PHONE,
    });
    agent = await startAgent(config);
    setState({ status: 'running', dockerMode: agent.dockerMode, phoneApp: agent.phoneApp ?? null });
  } catch (err) {
    setState({ status: 'failed', message: describeStartError(err) });
  }
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
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The viewer plays the profile's sound without a click first.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => win?.show());
  // The window shows only the app's own pages; links open in the user's own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadFile(path.join(here, 'renderer', 'index.html'));
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

app.on('window-all-closed', () => {
  // Tray behaviour comes with task H; until then closing the last window quits.
  void shutdown();
});

let quitting = false;
async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await agent?.close().catch(() => {});
  app.quit();
}

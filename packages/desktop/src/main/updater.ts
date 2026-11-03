// The app updates itself from GitHub Releases (github.com/johnabiotic-netizen/enclave-releases,
// DECISIONS 2026-11-03): it asks for the newest version on start and every few hours,
// downloads it in the background (only the changed parts where it can), and installs it when
// the person clicks Restart to update, or when Enclave quits. Nothing about the person or the
// profiles is sent; GitHub sees a request for the newest release.

import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/bridge.js';

const { autoUpdater } = electronUpdater;
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let state: UpdateState = { status: 'off' };
let notify: (s: UpdateState) => void = () => {};

function set(s: UpdateState): void {
  state = s;
  notify(s);
}

export function updateState(): UpdateState {
  return state;
}

/** Starts checking. A developer run (not installed) never updates. */
export function startUpdater(onChange: (s: UpdateState) => void): void {
  notify = onChange;
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  // Installed by Enclave's own quit (installOnQuit), which stops the profiles first.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    if (state.status !== 'downloading' && state.status !== 'ready') set({ status: 'checking' });
  });
  autoUpdater.on('update-not-available', () =>
    set({ status: 'current', checkedAt: new Date().toISOString() }),
  );
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, percent: 0 }),
  );
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') {
      set({ ...state, percent: Math.round(p.percent) });
    }
  });
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (e: Error) => {
    // A ready update stays ready; otherwise say why the check failed (no internet, mostly).
    if (state.status !== 'ready') set({ status: 'failed', message: e.message.split('\n')[0]! });
  });

  set({ status: 'idle' });
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS).unref();
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref();
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || state.status === 'downloading' || state.status === 'ready') return;
  await autoUpdater.checkForUpdates().catch(() => {
    // Reported through the error event.
  });
}

/**
 * The last step of Enclave quitting (after its profiles have stopped): if a downloaded
 * version is waiting, starts its installer without the wizard and quits; with `restart`,
 * Enclave starts again once it is installed. False when there is nothing to install.
 * (Enclave quits with app.exit, which electron-updater's own install-on-quit doesn't see.)
 */
export function installOnQuit(restart: boolean): boolean {
  if (state.status !== 'ready') return false;
  autoUpdater.quitAndInstall(true, restart);
  // quitAndInstall quits on the next tick; should anything hold the quit up, end anyway so
  // the installer finds Enclave closed.
  setTimeout(() => app.exit(0), 3000);
  return true;
}

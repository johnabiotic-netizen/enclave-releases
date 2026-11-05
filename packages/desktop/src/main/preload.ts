// The window's only way to the app: a few calls, no Node, no token.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentState, EnclaveBridge, TransferProgress, UpdateState } from '../shared/bridge.js';

const bridge: EnclaveBridge = {
  request: (method, path, body) => ipcRenderer.invoke('agent:request', method, path, body),
  agentState: () => ipcRenderer.invoke('agent:state'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setupChecks: () => ipcRenderer.invoke('setup:check'),
  installSystem: () => ipcRenderer.invoke('setup:install-system'),
  turnOnWsl: () => ipcRenderer.invoke('setup:turn-on-wsl'),
  saveSettings: (change) => ipcRenderer.invoke('settings:set', change),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
  openNotices: () => ipcRenderer.invoke('app:open-notices'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  saveDownload: (profileId, name) => ipcRenderer.invoke('downloads:save', profileId, name),
  showInFolder: (path) => ipcRenderer.invoke('downloads:show', path),
  exportProfile: (id, passphrase) => ipcRenderer.invoke('profiles:export', id, passphrase),
  pickProfileFile: () => ipcRenderer.invoke('profiles:pick-import'),
  importProfile: (passphrase) => ipcRenderer.invoke('profiles:import', passphrase),
  showExportedFile: () => ipcRenderer.invoke('profiles:show-exported'),
  onTransferProgress: (listener) => {
    const handler = (_e: IpcRendererEvent, p: TransferProgress) => listener(p);
    ipcRenderer.on('transfer:progress', handler);
    return () => ipcRenderer.removeListener('transfer:progress', handler);
  },
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (listener) => {
    const handler = (_e: IpcRendererEvent, s: UpdateState) => listener(s);
    ipcRenderer.on('update:state', handler);
    return () => ipcRenderer.removeListener('update:state', handler);
  },
  setFullScreen: (on) => ipcRenderer.invoke('window:set-fullscreen', on),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  onFullScreen: (listener) => {
    const handler = (_e: IpcRendererEvent, on: boolean) => listener(on);
    ipcRenderer.on('window:fullscreen', handler);
    return () => ipcRenderer.removeListener('window:fullscreen', handler);
  },
  onAgentState: (listener) => {
    const handler = (_e: IpcRendererEvent, state: AgentState) => listener(state);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.removeListener('agent:state', handler);
  },
};

contextBridge.exposeInMainWorld('enclave', bridge);

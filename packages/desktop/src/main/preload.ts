// The window's only way to the app: a few calls, no Node, no token.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentState, EnclaveBridge, TransferProgress } from '../shared/bridge.js';

const bridge: EnclaveBridge = {
  request: (method, path, body) => ipcRenderer.invoke('agent:request', method, path, body),
  agentState: () => ipcRenderer.invoke('agent:state'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setupChecks: () => ipcRenderer.invoke('setup:check'),
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
  onAgentState: (listener) => {
    const handler = (_e: IpcRendererEvent, state: AgentState) => listener(state);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.removeListener('agent:state', handler);
  },
};

contextBridge.exposeInMainWorld('enclave', bridge);

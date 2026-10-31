// The window's only way to the app: a few calls, no Node, no token.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentState, EnclaveBridge } from '../shared/bridge.js';

const bridge: EnclaveBridge = {
  request: (method, path, body) => ipcRenderer.invoke('agent:request', method, path, body),
  agentState: () => ipcRenderer.invoke('agent:state'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setupChecks: () => ipcRenderer.invoke('setup:check'),
  saveSettings: (change) => ipcRenderer.invoke('settings:set', change),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  onAgentState: (listener) => {
    const handler = (_e: IpcRendererEvent, state: AgentState) => listener(state);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.removeListener('agent:state', handler);
  },
};

contextBridge.exposeInMainWorld('enclave', bridge);

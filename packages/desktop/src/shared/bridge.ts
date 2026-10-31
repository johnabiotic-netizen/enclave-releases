// What the preload bridge gives the window (window.enclave). Shared by main, preload and renderer.

export type AgentState =
  | { status: 'starting' }
  | { status: 'running'; dockerMode: string; phoneApp: string | null }
  | { status: 'failed'; message: string };

export interface AgentReply {
  status: number;
  body: unknown;
}

/** The Settings screen's values (the default proxy in plain text: only this window sees it). */
export interface AppSettingsView {
  idleMinutes: number;
  defaultProxy: string;
  phone: boolean;
  dataFolder: string;
  versions: { app: string; electron: string; chromium: string; node: string };
}

export interface AppSettingsChange {
  idleMinutes?: number;
  defaultProxy?: string;
  phone?: boolean;
}

export interface EnclaveBridge {
  settings(): Promise<AppSettingsView>;
  /** Saves; a change to phone access or the idle default restarts the agent inside the app. */
  saveSettings(change: AppSettingsChange): Promise<void>;
  openDataFolder(): Promise<void>;
  /** A call to the agent's API (paths as in specs/agent-api.md, without /v1). */
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<AgentReply>;
  agentState(): Promise<AgentState>;
  /** Puts text on the Windows clipboard (works while the window is not focused). */
  copyText(text: string): Promise<void>;
  /** Called on every change; returns what stops listening. */
  onAgentState(listener: (state: AgentState) => void): () => void;
}

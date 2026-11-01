// What the preload bridge gives the window (window.enclave). Shared by main, preload and renderer.

export type AgentState =
  | { status: 'starting' }
  | { status: 'running'; dockerMode: string; phoneApp: string | null }
  | { status: 'failed'; message: string };

export interface AgentReply {
  status: number;
  body: unknown;
}

/** Through the Enclave relay (Stage 6), over Tailscale (Stage 2), or off. */
export type PhoneMode = 'relay' | 'tailscale' | 'off';

/** The Settings screen's values (the default proxy in plain text: only this window sees it). */
export interface AppSettingsView {
  idleMinutes: number;
  defaultProxy: string;
  /** How a phone reaches this PC's profiles. */
  phone: PhoneMode;
  dataFolder: string;
  versions: { app: string; electron: string; chromium: string; node: string };
}

export interface AppSettingsChange {
  idleMinutes?: number;
  defaultProxy?: string;
  phone?: PhoneMode;
}

/** One row of the setup checker. */
export interface SetupCheck {
  id: 'virtualization' | 'wsl' | 'docker-installed' | 'docker-running' | 'image';
  label: string;
  ok: boolean;
  detail: string;
  /** The exact steps to fix it, in order. */
  fix: string[];
  /** The fix is a button in the app instead: download the browser image. */
  action?: 'download-image';
}

export interface EnclaveBridge {
  /** Runs every setup check (restarting Enclave's service first if it is not running). */
  setupChecks(): Promise<SetupCheck[]>;
  settings(): Promise<AppSettingsView>;
  /** Saves; a change to phone access or the idle default restarts the agent inside the app. */
  saveSettings(change: AppSettingsChange): Promise<void>;
  openDataFolder(): Promise<void>;
  /** Opens the folder with every third party license (notices/ beside the app). */
  openNotices(): Promise<void>;
  /** A call to the agent's API (paths as in specs/agent-api.md, without /v1). */
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<AgentReply>;
  agentState(): Promise<AgentState>;
  /**
   * Saves a file the profile downloaded into this PC's Downloads folder (marked as from the
   * internet, as a browser does) and gives where it went. Never opens it.
   */
  saveDownload(profileId: string, name: string): Promise<{ path: string }>;
  /** Shows a saved download in File Explorer. */
  showInFolder(path: string): Promise<void>;
  /** Puts text on the Windows clipboard (works while the window is not focused). */
  copyText(text: string): Promise<void>;
  /** Called on every change; returns what stops listening. */
  onAgentState(listener: (state: AgentState) => void): () => void;
}

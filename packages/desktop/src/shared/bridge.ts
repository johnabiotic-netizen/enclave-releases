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
  /**
   * The fix is a button in the app: download the browser image, set up Enclave's own Linux
   * system with Docker, or turn WSL on.
   */
  action?: 'download-image' | 'install-system' | 'turn-on-wsl';
}

/** How an export went. Failures carry a message for the person, not an exception. */
export type ExportResult =
  | { status: 'saved'; path: string; bytes: number }
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

export type ImportResult =
  | {
      status: 'imported';
      id: string;
      name: string;
      /** Made on a PC with another graphics card: imported, but it can't start here. */
      otherGpu?: { madeOn: string; current: string | null };
    }
  | { status: 'failed'; code?: string; message: string };

/** Progress of the export or import under way: bytes so far, and the total when known. */
export interface TransferProgress {
  done: number;
  total?: number;
}

export interface EnclaveBridge {
  /** Sets up Enclave's own Linux system with Docker in WSL, then restarts Enclave's service. */
  installSystem(): Promise<{ ok: boolean; message?: string }>;
  /** Turns WSL on (Windows asks for permission); a restart finishes it. */
  turnOnWsl(): Promise<{ ok: boolean; message?: string }>;
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
  /**
   * Exports a stopped profile to one encrypted file: asks where to save it, then writes it.
   * Not in the agent's HTTP API on purpose (specs/profile-file.md).
   */
  exportProfile(id: string, passphrase: string): Promise<ExportResult>;
  /** Asks for a profile file to import; gives its name, or null if none was chosen. */
  pickProfileFile(): Promise<string | null>;
  /** Imports the file chosen with pickProfileFile. */
  importProfile(passphrase: string): Promise<ImportResult>;
  /** Shows the last exported file in File Explorer. */
  showExportedFile(): Promise<void>;
  onTransferProgress(listener: (progress: TransferProgress) => void): () => void;
}

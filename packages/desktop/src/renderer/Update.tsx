// The app's own update (main/updater.ts): a note when a new version is ready, and its line
// in Settings.

import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/bridge';

function useUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'off' });
  useEffect(() => {
    void window.enclave.updateState().then(setState);
    return window.enclave.onUpdateState(setState);
  }, []);
  return state;
}

/** Shown once a new version has downloaded, until Restart to update or Later. */
export function UpdateBanner() {
  const update = useUpdate();
  const [later, setLater] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  if (update.status !== 'ready' || later === update.version) return null;
  return (
    <div className="update-banner" role="status">
      <p>
        <strong>Enclave {update.version} is ready.</strong> Restarting stops your running profiles;
        their tabs and logins are there when you start them again.
      </p>
      <div className="row">
        <button className="button quiet small" onClick={() => setLater(update.version)}>
          Later
        </button>
        <button
          className="button primary small"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            void window.enclave.installUpdate();
          }}
        >
          {installing ? 'Stopping profiles' : 'Restart to update'}
        </button>
      </div>
    </div>
  );
}

/** The Updates line in Settings. */
export function UpdateSettings({ version }: { version: string }) {
  const update = useUpdate();
  const text = (() => {
    switch (update.status) {
      case 'off':
        return 'This copy of Enclave isn’t installed, so it doesn’t update itself.';
      case 'idle':
        return 'Enclave checks for a new version shortly after it starts.';
      case 'checking':
        return 'Checking for a new version.';
      case 'current':
        return `You have the newest version. Checked at ${new Date(update.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
      case 'downloading':
        return `Downloading Enclave ${update.version}: ${update.percent}%. It installs when you restart Enclave.`;
      case 'ready':
        return `Enclave ${update.version} is ready to install.`;
      case 'failed':
        return `Couldn’t check for a new version (${update.message}). Enclave tries again later.`;
    }
  })();
  return (
    <>
      <p>
        Version <span className="mono">{version}</span>. {text}
      </p>
      <p className="muted small">
        Enclave asks GitHub for its newest version and location data. Nothing about you or your
        profiles is sent.
      </p>
      <div className="row">
        {update.status === 'ready' ? (
          <button className="button primary" onClick={() => void window.enclave.installUpdate()}>
            Restart to update
          </button>
        ) : (
          <button
            className="button"
            disabled={
              update.status === 'off' ||
              update.status === 'checking' ||
              update.status === 'downloading'
            }
            onClick={() => void window.enclave.checkForUpdates()}
          >
            Check for updates
          </button>
        )}
      </div>
    </>
  );
}

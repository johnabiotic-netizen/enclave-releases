// Export a profile to one encrypted file, and import one (specs/profile-file.md).

import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@enclave/shared';
import type { ImportResult, TransferProgress } from '../shared/bridge';

const MIN = 10;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 100 * 1024 ** 2 ? 1 : 0)} MB`;
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return ref;
}

function useProgress(active: boolean): TransferProgress | null {
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    setProgress(null);
    return window.enclave.onTransferProgress(setProgress);
  }, [active]);
  return progress;
}

export function ExportDialog(props: { profile: Profile; onClose(): void }) {
  const ref = useModal();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ path: string; bytes: number } | null>(null);
  const progress = useProgress(busy);
  const tooShort = [...pass].length < MIN;
  const mismatch = again.length > 0 && again !== pass;

  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await window.enclave.exportProfile(props.profile.id, pass);
    setBusy(false);
    if (r.status === 'saved') setSaved(r);
    else if (r.status === 'failed') setError(r.message);
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => (busy ? e.preventDefault() : props.onClose())}
      aria-labelledby="export-title"
    >
      <h2 id="export-title">Export {props.profile.name}</h2>
      {saved ? (
        <>
          <p>
            Saved as <span className="mono">{saved.path}</span> ({size(saved.bytes)}).
          </p>
          <p>Keep the passphrase somewhere safe. Without it, the file can&apos;t be opened.</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => void window.enclave.showExportedFile()}>
              Show in folder
            </button>
            <button className="button primary" onClick={props.onClose} autoFocus>
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && again === pass && !busy) void run();
          }}
        >
          <p>
            One encrypted file with this profile&apos;s settings, proxy password, and browser data:
            logins, open tabs and history. It opens on a PC with the same graphics card.
          </p>
          <p>
            Anyone with the file and the passphrase can use the profile. Enclave can&apos;t recover
            a lost passphrase.
          </p>
          <div className="transfer-fields">
            <label className="field">
              <span>Passphrase</span>
              <input
                type="password"
                autoComplete="new-password"
                value={pass}
                disabled={busy}
                autoFocus
                onChange={(e) => setPass(e.target.value)}
              />
              {pass.length > 0 && tooShort && (
                <small className="error-text">At least {MIN} characters.</small>
              )}
            </label>
            <label className="field">
              <span>Passphrase again</span>
              <input
                type="password"
                autoComplete="new-password"
                value={again}
                disabled={busy}
                onChange={(e) => setAgain(e.target.value)}
              />
              {mismatch && <small className="error-text">The two don&apos;t match.</small>}
            </label>
          </div>
          {busy && (
            <p role="status">
              Exporting. {progress ? `${size(progress.done)} of browser data read.` : ''}
            </p>
          )}
          {error && <p className="notice error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || tooShort || again !== pass}
            >
              Choose where to save
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function ImportDialog(props: {
  fileName: string;
  onClose(): void;
  onImported(id: string): void;
}) {
  const ref = useModal();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ImportResult, { status: 'imported' }> | null>(null);
  const progress = useProgress(busy);
  const tooShort = [...pass].length < MIN;

  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await window.enclave.importProfile(pass);
    setBusy(false);
    if (r.status === 'imported') setDone(r);
    else setError(r.message);
  };
  const share = progress?.total ? progress.done / progress.total : 0;

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => (busy ? e.preventDefault() : props.onClose())}
      aria-labelledby="import-title"
    >
      <h2 id="import-title">Import a profile</h2>
      {done ? (
        <>
          <p>{done.name} is imported, with its fingerprint and browser data.</p>
          {done.otherGpu && (
            <p className="notice error">
              It was made on a PC with {done.otherGpu.madeOn}
              {done.otherGpu.current ? `, and this PC has ${done.otherGpu.current}` : ''}. It
              can&apos;t start here without changing its fingerprint. Keep the file as a backup, or
              use it on a PC with the same graphics card.
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button primary"
              autoFocus
              onClick={() => {
                props.onImported(done.id);
                props.onClose();
              }}
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort && !busy) void run();
          }}
        >
          <p>
            From <span className="mono">{props.fileName}</span>. Enter the passphrase it was
            exported with.
          </p>
          <div className="transfer-fields">
            <label className="field">
              <span>Passphrase</span>
              <input
                type="password"
                autoComplete="off"
                value={pass}
                disabled={busy}
                autoFocus
                onChange={(e) => setPass(e.target.value)}
              />
            </label>
          </div>
          {busy && (
            <div role="status" className="transfer-progress">
              <progress max={1} value={share} aria-label="Import" />
              <span>Importing. {Math.round(share * 100)}%</span>
            </div>
          )}
          {error && <p className="notice error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy || tooShort}>
              Import profile
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

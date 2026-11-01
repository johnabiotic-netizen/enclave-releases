// Screen 1 (ui/screens.md): the setup checker. Each check is green, or shows the exact fix.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageDownload } from '@enclave/shared';
import type { SetupCheck } from '../shared/bridge';
import { api } from './api';

export function Setup(props: { onReady(): void; firstRun: boolean }) {
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const next = await window.enclave.setupChecks();
      setChecks(next);
      setOpen((o) => o ?? next.find((c) => !c.ok)?.id ?? null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  const ready = checks?.every((c) => c.ok) ?? false;

  return (
    <section className="page">
      <div className="setup">
        <h1>Setup</h1>
        <p className="muted lead">
          Enclave runs each profile in its own sealed space on this PC, using Docker. These checks
          show what is in place and how to fix anything that is not.
        </p>
        {!checks ? (
          <p className="muted">Checking this PC. This takes a few seconds.</p>
        ) : (
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.id} className={c.ok ? 'ok' : 'fail'}>
                <div className="check-row">
                  <span className="check-mark" aria-hidden="true" />
                  <div className="check-text">
                    <strong>{c.label}</strong>
                    <span className="muted">{c.detail}</span>
                  </div>
                  {!c.ok && (
                    <button
                      className="button small"
                      aria-expanded={open === c.id}
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                    >
                      Fix
                    </button>
                  )}
                </div>
                {!c.ok && open === c.id && (
                  <ol className="fix">
                    {c.fix.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {!c.ok && open === c.id && c.action === 'download-image' && (
                  <DownloadBrowser onDone={() => void recheck()} />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="row setup-actions">
          <button className="button" onClick={() => void recheck()} disabled={checking}>
            {checking ? 'Checking' : 'Recheck'}
          </button>
          {ready && (
            <>
              <span className="ready">You&apos;re ready.</span>
              {props.firstRun && (
                <button className="button primary" onClick={props.onReady}>
                  Go to profiles
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const POLL_MS = 1000;

/** The browser image's one-time download, with its progress. */
function DownloadBrowser(props: { onDone(): void }) {
  const [status, setStatus] = useState<ImageDownload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onDone = useRef(props.onDone);
  onDone.current = props.onDone;

  // A download already running (the window was reopened) shows its progress.
  useEffect(() => {
    let alive = true;
    let finished = false;
    const poll = async () => {
      try {
        const s = await api<ImageDownload>('GET', '/system/image');
        if (!alive) return;
        setStatus(s);
        if (s.state === 'done' && !finished) {
          finished = true;
          onDone.current();
        }
      } catch {
        // the next poll tries again
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      setStatus(await api<ImageDownload>('POST', '/system/image'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
  const downloading = status?.state === 'downloading';
  const share = status && status.totalBytes > 0 ? status.downloadedBytes / status.totalBytes : 0;
  return (
    <div className="download-browser">
      {(error || status?.error) && <p className="notice error">{error ?? status?.error}</p>}
      {downloading ? (
        <>
          <progress max={1} value={share} aria-label="Browser download" />
          <p className="muted small">
            {status.totalBytes > 0
              ? `${gb(status.downloadedBytes)} of ${gb(status.totalBytes)}`
              : 'Starting'}
            {status.layers > 0 && `, ${status.layersDone} of ${status.layers} parts unpacked`}
          </p>
        </>
      ) : (
        <button className="button primary" onClick={() => void start()}>
          {status?.state === 'failed' ? 'Try again' : 'Download the browser'}
        </button>
      )}
    </div>
  );
}

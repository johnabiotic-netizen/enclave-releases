// Screen 1 (ui/screens.md): the setup checker. Each check is green, or shows the exact fix.

import { useCallback, useEffect, useState } from 'react';
import type { SetupCheck } from '../shared/bridge';

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

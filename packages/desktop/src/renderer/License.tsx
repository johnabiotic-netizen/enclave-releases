// The license screen (specs/license.md) and its line in Settings.

import { useEffect, useState } from 'react';
import type { LicenseProblem, LicenseStatus } from '@enclave/shared';

const WHY: Record<LicenseProblem, string> = {
  malformed: "That doesn't look like a license key. Paste the whole key you were sent.",
  'bad-signature': "This key isn't valid. Check that you pasted all of it, or ask for a new one.",
  expired: 'This key has expired. Ask for a new one.',
  revoked: 'This key was turned off. Contact the person who sent it to you.',
  'other-pc': 'This key is already used on another PC. Ask for it to be moved to this one.',
  unreachable:
    "Enclave couldn't reach the license server. Check your internet connection and try again.",
};

export function useLicense(): LicenseStatus | null {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  useEffect(() => {
    void window.enclave.licenseState().then(setStatus);
    return window.enclave.onLicenseState(setStatus);
  }, []);
  return status;
}

/** Shown instead of the app until there is a valid license. */
export function LicenseGate({ status }: { status: LicenseStatus }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<LicenseProblem | undefined>(status.problem);

  async function activate() {
    setBusy(true);
    try {
      const result = await window.enclave.activateLicense(key);
      setProblem(result.licensed ? undefined : (result.problem ?? 'bad-signature'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell no-rail">
      <main className="main">
        <section className="page">
          <div className="settings" style={{ maxWidth: 560, margin: '12vh auto 0' }}>
            <h1>Enter your license key</h1>
            <p>
              Enclave is open to people who have been given a license. Paste the key you were sent,
              then choose Activate. Your key works on one PC.
            </p>
            {problem && <p className="notice error">{WHY[problem]}</p>}
            <textarea
              aria-label="License key"
              className="mono"
              rows={4}
              spellCheck={false}
              placeholder="ENC1-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{ width: '100%' }}
            />
            <p>
              <button
                type="button"
                className="btn primary"
                disabled={busy || key.trim().length < 10}
                onClick={() => void activate()}
              >
                {busy ? 'Checking' : 'Activate'}
              </button>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

/** The license line in Settings. */
export function LicenseSettings() {
  const status = useLicense();
  if (!status) return null;
  const when = status.lastCheck ? new Date(status.lastCheck).toLocaleDateString() : 'not yet';
  return (
    <dl className="about-list">
      <dt>Licensed to</dt>
      <dd>{status.name ?? 'No license'}</dd>
      {status.expires && (
        <>
          <dt>Valid until</dt>
          <dd className="mono">{status.expires}</dd>
        </>
      )}
      <dt>Last checked</dt>
      <dd>{when}</dd>
    </dl>
  );
}

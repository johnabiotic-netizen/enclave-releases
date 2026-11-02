// The profile audit (testing/test-suite.md) in the app: check pages run in a throwaway copy of
// the profile, never the profile itself, and each finding says pass, fail or look.

import { useEffect, useState } from 'react';
import {
  AUDIT_CHECKS,
  type AuditJobView,
  type Finding,
  type Profile,
  type StartAuditRequest,
  type Verdict,
} from '@enclave/shared';
import { api, ApiFailure } from './api';
import { BackIcon } from './icons';

const POLL_MS = 5000;
const VERDICT_WORD: Record<Verdict, string> = {
  pass: 'Pass',
  fail: 'Fail',
  look: 'Look',
  info: 'Info',
};
const VERDICT_CLASS: Record<Verdict, string> = {
  pass: 'good',
  fail: 'bad',
  look: 'warning',
  info: 'info',
};

/** The last audit of each profile, kept while the app runs. */
const kept = new Map<string, AuditJobView>();

function label(check: string): string {
  return (
    AUDIT_CHECKS.find((c) => c.id === check)?.label ?? (check === 'audit' ? 'Audit run' : check)
  );
}

/** "3 of 4 pass, 2 for information": information lines aren't checks, so they don't count. */
function groupCount(fs: Finding[]): string {
  const checked = fs.filter((f) => f.verdict !== 'info');
  const info = fs.length - checked.length;
  const passed = checked.filter((f) => f.verdict === 'pass').length;
  const parts = [
    ...(checked.length ? [`${passed} of ${checked.length} pass`] : []),
    ...(info ? [`${info} for information`] : []),
  ];
  return parts.join(', ');
}

function elapsed(since: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function AuditPage(props: { profile: Profile; onBack(): void }) {
  const { profile } = props;
  const [job, setJob] = useState<AuditJobView | null>(kept.get(profile.id) ?? null);
  const [chosen, setChosen] = useState<string[]>(AUDIT_CHECKS.map((c) => c.id));
  const [baseline, setBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const running = job?.state === 'running';

  useEffect(() => {
    if (job) kept.set(profile.id, job);
  }, [job, profile.id]);

  const jobId = running ? job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const poll = window.setInterval(() => {
      void api<AuditJobView>('GET', `/audits/${jobId}`).then(
        (j) => alive && setJob(j),
        () => {},
      );
    }, POLL_MS);
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [jobId]);

  const start = async () => {
    setError(null);
    const all = chosen.length === AUDIT_CHECKS.length;
    const body: StartAuditRequest = {
      ...(all ? {} : { checks: chosen }),
      ...(baseline ? { saveBaseline: true } : {}),
    };
    try {
      setJob(await api<AuditJobView>('POST', `/profiles/${profile.id}/audit`, body));
    } catch (e) {
      setError(e instanceof ApiFailure || e instanceof Error ? e.message : String(e));
    }
  };

  const findings = job?.state === 'done' ? (job.run?.findings ?? []) : [];
  const count = (v: Verdict) => findings.filter((f) => f.verdict === v).length;
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.check, [...(groups.get(f.check) ?? []), f]);
  // Checks with a failure first, then those to look at.
  const order = (fs: Finding[]) =>
    fs.some((f) => f.verdict === 'fail') ? 0 : fs.some((f) => f.verdict === 'look') ? 1 : 2;
  const sortedGroups = [...groups.entries()].sort((a, b) => order(a[1]) - order(b[1]));

  return (
    <section className="page audit">
      <header className="wizard-head">
        <button className="icon-button" aria-label="Back to profiles" onClick={props.onBack}>
          <BackIcon />
        </button>
        <h1>Check fingerprint: {profile.name}</h1>
      </header>
      <p className="lead-text">
        Opens check sites in a throwaway copy of {profile.name}, with its fingerprint and proxy, and
        reads what they see. The profile itself, its logins and tabs are never touched, and it can
        keep running meanwhile. All checks take about 3 to 5 minutes.
      </p>

      <fieldset className="audit-checks" disabled={running}>
        <legend>Checks</legend>
        {AUDIT_CHECKS.map((c) => (
          <label key={c.id} className="toggle">
            <input
              type="checkbox"
              checked={chosen.includes(c.id)}
              onChange={(e) =>
                setChosen((now) =>
                  e.target.checked ? [...now, c.id] : now.filter((x) => x !== c.id),
                )
              }
            />
            <span>
              {c.label}
              <small>{c.about}</small>
            </span>
          </label>
        ))}
        <label className="toggle">
          <input
            type="checkbox"
            checked={baseline}
            onChange={(e) => setBaseline(e.target.checked)}
          />
          <span>
            Save as this profile&apos;s baseline
            <small>
              Later checks compare the browser values with it, to confirm the fingerprint stays the
              same. Save one from a run that passes.
            </small>
          </span>
        </label>
      </fieldset>

      <div className="row">
        <button
          className="button primary"
          onClick={() => void start()}
          disabled={running || chosen.length === 0}
        >
          {running ? 'Checking' : job ? 'Check again' : 'Run checks'}
        </button>
        {running && (
          <span className="muted" role="status">
            Running for {elapsed(job.startedAt)}. You can leave this screen; the check keeps going.
          </span>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
      {job?.state === 'failed' && (
        <p className="notice error">The check didn&apos;t finish. {job.error}</p>
      )}

      {job?.state === 'done' && job.run && (
        <div className="audit-results">
          <p className="audit-summary">
            <span className="rating good">{count('pass')} pass</span>{' '}
            <span className="rating bad">{count('fail')} fail</span>{' '}
            <span className="rating warning">{count('look')} to look at</span>
            {job.run.exitIp && (
              <span className="muted">
                {' '}
                Exit IP <span className="mono">{job.run.exitIp}</span>
              </span>
            )}
          </p>
          <p className="muted small">
            Screenshots and the full report are in <span className="mono">{job.run.reportDir}</span>
            . &quot;Look&quot; means the page didn&apos;t show a value Enclave could read; its
            screenshot shows what it said.
          </p>
          {sortedGroups.map(([check, fs]) => (
            <details key={check} className="audit-group" open={order(fs) < 2}>
              <summary>
                <strong>{label(check)}</strong>
                <span className="muted"> {groupCount(fs)}</span>
                {fs.some((f) => f.verdict === 'fail') && <span className="rating bad">Fail</span>}
                {!fs.some((f) => f.verdict === 'fail') && fs.some((f) => f.verdict === 'look') && (
                  <span className="rating warning">Look</span>
                )}
              </summary>
              <table className="tester-table audit-table">
                <tbody>
                  {fs.map((f, i) => (
                    <tr key={`${f.item}-${i}`}>
                      <td>
                        <span className={`rating ${VERDICT_CLASS[f.verdict]}`}>
                          {VERDICT_WORD[f.verdict]}
                        </span>
                      </td>
                      <td>{f.item}</td>
                      <td className="mono audit-value">
                        {f.value ?? ''}
                        {f.expected !== undefined && f.expected !== f.value && (
                          <span className="muted"> expected {f.expected}</span>
                        )}
                      </td>
                      <td className="muted">{f.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

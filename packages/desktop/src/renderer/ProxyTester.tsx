// The proxy tester (testing/test-suite.md): many proxies at once, or a range of ports, with the
// same rating the create wizard's Check proxy shows. Also the wizard's Enclave Scan deep check.

import { useEffect, useState } from 'react';
import {
  addressKind,
  expandProxyLines,
  MAX_PROXY_TEST,
  rateProxy,
  type ProxyLevel,
  type ProxyTestJob,
  type ProxyTestRequest,
  type ProxyTestResult,
} from '@enclave/shared';
import { api, ApiFailure } from './api';
import { Flag } from './Flag';
import { countryName } from './format';

const POLL_MS = 2000;
const STICKY_MINUTES = 5;
const LEVEL_WORD: Record<ProxyLevel, string> = {
  good: 'Good',
  warning: 'Works, with a warning',
  bad: 'Not usable',
};

export function RatingBadge({ level, short }: { level: ProxyLevel; short?: boolean }) {
  return (
    <span className={`rating ${level}`}>
      {short ? { good: 'Good', warning: 'Warning', bad: 'Not usable' }[level] : LEVEL_WORD[level]}
    </span>
  );
}

function message(e: unknown): string {
  return e instanceof ApiFailure || e instanceof Error ? e.message : String(e);
}

/** Polls a proxy test until it is done; the agent keeps running it if the screen closes. */
function usePolledJob(initial: ProxyTestJob | null) {
  const [job, setJob] = useState<ProxyTestJob | null>(initial);
  const id = job?.state === 'running' ? job.id : null;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const timer = window.setInterval(() => {
      void api<ProxyTestJob>('GET', `/proxy-tests/${id}`).then(
        (j) => alive && setJob(j),
        () => {},
      );
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id]);
  return [job, setJob] as const;
}

// ---------------------------------------------------------------- the wizard's deep check

/** Enclave Scan through one proxy, on request: about 1 to 2 minutes. */
export function DeepCheck({ proxy }: { proxy: string }) {
  const [job, setJob] = usePolledJob(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    const body: ProxyTestRequest = { proxies: [proxy], stickyMinutes: 0, scan: true };
    try {
      setJob(await api<ProxyTestJob>('POST', '/proxy-tests', body));
    } catch (e) {
      setError(message(e));
    }
  };
  const row = job?.state === 'done' ? job.results?.[0] : undefined;
  const rating = row ? rateProxy(row) : null;

  return (
    <div className="deep-check">
      {!job && (
        <div className="row">
          <button className="button" onClick={() => void run()}>
            Deep check
          </button>
          <span className="muted">
            Opens Enclave Scan through this proxy in a temporary profile and reads its verdict.
            About 1 to 2 minutes.
          </span>
        </div>
      )}
      {job?.state === 'running' && (
        <p className="muted" role="status">
          Checking with Enclave Scan. This takes 1 to 2 minutes.
        </p>
      )}
      {row && rating && (
        <div className={`rated ${rating.level}`}>
          <strong>Deep check</strong>{' '}
          {row.scan === undefined ? (
            <span className="muted">Enclave Scan didn&apos;t run: the proxy failed its check.</span>
          ) : (
            <>
              <RatingBadge level={rating.level} />
              <p>
                {row.scan === 'consistent'
                  ? 'Enclave Scan says consistent: it sees nothing that gives the proxy away.'
                  : rating.notes[0]}
              </p>
            </>
          )}
        </div>
      )}
      {job?.state === 'failed' && <p className="notice error">{job.error}</p>}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- the tester screen

/** The last test, kept while the app runs, so leaving the screen doesn't lose it. */
let kept: { text: string; job: ProxyTestJob | null; inputs: string[] } = {
  text: '',
  job: null,
  inputs: [],
};

function phaseText(job: ProxyTestJob): string {
  switch (job.phase) {
    case 'first check':
      return `Checking ${job.checked} of ${job.total}.`;
    case 'reputation':
      return 'Looking up each exit IP in the IP databases.';
    case 'waiting for the sticky check': {
      const at = job.stickyAt ? new Date(job.stickyAt) : null;
      return at
        ? `Checking each IP again at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The table is usable meanwhile.`
        : 'Waiting to check each IP again.';
    }
    case 'sticky check':
      return 'Checking each IP again.';
    case 'scan':
      return `Enclave Scan, ${job.checked} of ${job.total}. About 1.5 minutes each.`;
  }
}

/** host:port of a proxy shown without its password (scheme://user@host:port). */
function hostPort(proxy: string): string {
  return proxy.replace(/^\w+:\/\/([^@]*@)?/, '');
}

export function ProxyTesterPage(props: { onCreate(proxy: string): void }) {
  const [text, setText] = useState(kept.text);
  const [sticky, setSticky] = useState(false);
  const [scan, setScan] = useState(false);
  const [inputs, setInputs] = useState<string[]>(kept.inputs);
  const [job, setJob] = usePolledJob(kept.job);
  const [error, setError] = useState<string | null>(null);
  const [hideBad, setHideBad] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    kept = { text, job, inputs };
  }, [text, job, inputs]);

  const parsed = expandProxyLines(text);
  const running = job?.state === 'running';

  const start = async () => {
    setError(null);
    setCopied(false);
    const body: ProxyTestRequest = {
      proxies: parsed.proxies,
      stickyMinutes: sticky ? STICKY_MINUTES : 0,
      scan,
    };
    try {
      const started = await api<ProxyTestJob>('POST', '/proxy-tests', body);
      setInputs(parsed.proxies);
      setJob(started);
    } catch (e) {
      setError(message(e));
    }
  };

  const rows = (job?.results ?? []).map((r) => ({ r, rating: rateProxy(r) }));
  const checked = rows.filter((x) => !x.r.pending);
  const count = (level: ProxyLevel) => checked.filter((x) => x.rating.level === level).length;
  const shown = hideBad ? rows.filter((x) => x.r.pending || x.rating.level !== 'bad') : rows;
  const good = checked.filter((x) => x.rating.level === 'good');

  return (
    <section className="page proxy-tester">
      <div className="page-head">
        <h1>Proxy tester</h1>
      </div>
      <p className="lead-text">
        Test many proxies at once and see which are worth using. Paste one per line, in any form the
        create wizard takes. A port can be a range, for example{' '}
        <span className="mono">host:10001-10100:user:pass</span> or{' '}
        <span className="mono">socks5://user:pass@host:10001-10100</span>.
      </p>
      <textarea
        className="mono tester-input"
        rows={6}
        spellCheck={false}
        value={text}
        disabled={running}
        onChange={(e) => setText(e.target.value)}
        placeholder="socks5://user:pass@host:10001-10050"
        aria-label="Proxies to test"
      />
      <div className="tester-options">
        <label className="toggle">
          <input
            type="checkbox"
            checked={sticky}
            disabled={running}
            onChange={(e) => setSticky(e.target.checked)}
          />
          <span>
            Check that each IP stays the same
            <small>
              Checks every working proxy again after {STICKY_MINUTES} minutes. A profile needs an IP
              that doesn&apos;t change, or sites sign it out.
            </small>
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={scan}
            disabled={running}
            onChange={(e) => setScan(e.target.checked)}
          />
          <span>
            Enclave Scan check
            <small>
              Opens Enclave Scan through each working proxy in a temporary profile. The surest test,
              and slow: about 1.5 minutes per proxy.
            </small>
          </span>
        </label>
      </div>
      <div className="row">
        <button
          className="button primary"
          onClick={() => void start()}
          disabled={running || !!parsed.error || parsed.proxies.length === 0}
        >
          {parsed.proxies.length > 1
            ? `Test ${parsed.proxies.length} proxies`
            : parsed.proxies.length === 1
              ? 'Test 1 proxy'
              : 'Test proxies'}
        </button>
        {parsed.error && <span className="error-text">{parsed.error}</span>}
        {!parsed.error && parsed.proxies.length === 0 && (
          <span className="muted">Up to {MAX_PROXY_TEST} in one test.</span>
        )}
      </div>
      <p className="muted small tester-privacy">
        Each exit IP is checked against an external IP reputation database over an unencrypted
        connection. Only the IP address is sent, never the proxy&apos;s login.
      </p>
      {error && <p className="notice error">{error}</p>}

      {job && (
        <div className="tester-results">
          <div className="tester-summary">
            {running && (
              <div role="status" className="tester-progress">
                <progress
                  max={1}
                  value={job.total ? job.checked / job.total : 0}
                  aria-label="Test progress"
                />
                <span>{phaseText(job)}</span>
              </div>
            )}
            {job.state === 'failed' && <p className="notice error">{job.error}</p>}
            {checked.length > 0 && (
              <p>
                <span className="rating good">{count('good')} good</span>{' '}
                <span className="rating warning">{count('warning')} with a warning</span>{' '}
                <span className="rating bad">{count('bad')} not usable</span>
              </p>
            )}
            <span className="spacer" />
            <label className="inline-check">
              <input
                type="checkbox"
                checked={hideBad}
                onChange={(e) => setHideBad(e.target.checked)}
              />
              Hide proxies that aren&apos;t usable
            </label>
            <button
              className="button small"
              disabled={good.length === 0}
              onClick={() =>
                void window.enclave
                  .copyText(good.map((x) => inputs[x.r.index] ?? '').join('\n'))
                  .then(() => setCopied(true))
              }
            >
              {copied ? 'Copied' : `Copy ${good.length} good`}
            </button>
          </div>
          {job.state === 'done' && job.reportDir && (
            <p className="muted small">
              Best first. Report saved in <span className="mono">{job.reportDir}</span>
            </p>
          )}
          <div className="table-wrap">
            <table className="tester-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Proxy</th>
                  <th>Exit IP</th>
                  <th>Location</th>
                  <th>Address type</th>
                  <th>Speed</th>
                  <th>Why</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ r, rating }) => (
                  <Row
                    key={r.index}
                    r={r}
                    level={rating.level}
                    notes={rating.notes}
                    onCreate={() => props.onCreate(inputs[r.index] ?? '')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Row(props: { r: ProxyTestResult; level: ProxyLevel; notes: string[]; onCreate(): void }) {
  const { r } = props;
  if (r.pending) {
    return (
      <tr className="pending">
        <td className="muted">Waiting</td>
        <td className="mono" title={r.proxy}>
          {hostPort(r.proxy)}
        </td>
        <td colSpan={6} />
      </tr>
    );
  }
  const place = [countryName(r.country), r.city].filter(Boolean).join(', ');
  return (
    <tr>
      <td>
        <RatingBadge level={props.level} short />
      </td>
      <td className="mono" title={r.proxy}>
        {hostPort(r.proxy)}
      </td>
      <td className="nowrap">
        {r.exitIp ? (
          <>
            <Flag code={r.country} /> <span className="mono">{r.exitIp}</span>
          </>
        ) : (
          <span className="muted">None</span>
        )}
      </td>
      <td>{place || <span className="muted">Unknown</span>}</td>
      <td>{addressKind(r) ?? <span className="muted">Unknown</span>}</td>
      <td className="mono">{r.latencyMs !== undefined ? `${r.latencyMs} ms` : ''}</td>
      <td className="why">
        {props.notes.length > 0 ? (
          <ul>
            {props.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {r.isp && <span className="muted small">{r.isp}</span>}
      </td>
      <td>
        {r.ok && (
          <button className="button small" onClick={props.onCreate}>
            Create profile
          </button>
        )}
      </td>
    </tr>
  );
}

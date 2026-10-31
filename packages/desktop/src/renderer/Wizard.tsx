// Screen 3 (ui/screens.md): create a profile in steps, or edit one.

import { useEffect, useState } from 'react';
import type {
  CheckNewProxyRequest,
  CreateProfileRequest,
  Profile,
  ProxyCheckResult,
  SystemResponse,
  UpdateProfileRequest,
} from '@enclave/shared';
import { api, ApiFailure } from './api';
import { Flag } from './Flag';
import { countryName } from './format';
import { BackIcon } from './icons';

const STEPS = ['Name', 'Proxy', 'Device', 'Review'] as const;
const PROXY_FORMATS =
  'socks5://user:pass@host:port, http://user:pass@host:port or host:port:user:pass';

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; result: ProxyCheckResult; checkedFor: string }
  | { state: 'failed'; message: string };

/** What to try after a failed check, by the agent's error code. */
function nextStep(e: unknown): string {
  if (!(e instanceof ApiFailure)) return (e as Error).message;
  // The agent's own message already says what to try for an unreachable proxy.
  if (e.code === 'REAL_IP_LEAK_SUSPECTED')
    return `${e.message} Use a different proxy: this one may show your real IP.`;
  if (e.code === 'DOCKER_DOWN') return `${e.message} Open Setup to fix it.`;
  return e.message;
}

export function CreateWizard(props: { onDone(id: string | null): void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [proxy, setProxy] = useState('');
  const [testProxy, setTestProxy] = useState(false);
  const [testProxyAvailable, setTestProxyAvailable] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<SystemResponse>('GET', '/system').then(
      (s) => setTestProxyAvailable(s.testProxyAvailable),
      () => {},
    );
  }, []);

  const proxyKey = testProxy ? 'test' : proxy.trim();
  const checked = check.state === 'ok' && check.checkedFor === proxyKey;

  const runCheck = async () => {
    setCheck({ state: 'checking' });
    const body: CheckNewProxyRequest = testProxy ? { useTestProxy: true } : { proxy: proxy.trim() };
    try {
      const result = await api<ProxyCheckResult>('POST', '/proxy-check', body);
      setCheck({ state: 'ok', result, checkedFor: proxyKey });
    } catch (e) {
      setCheck({ state: 'failed', message: nextStep(e) });
    }
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    const body: CreateProfileRequest = testProxy
      ? { name: name.trim(), useTestProxy: true }
      : { name: name.trim(), proxy: proxy.trim() };
    try {
      const profile = await api<Profile>('POST', '/profiles', body);
      if (notes.trim()) {
        await api<Profile>('PATCH', `/profiles/${profile.id}`, { notes: notes.trim() });
      }
      props.onDone(profile.id);
    } catch (e) {
      setError(nextStep(e));
      setCreating(false);
    }
  };

  const canNext = [name.trim().length > 0, checked, true, true][step];

  return (
    <section className="page wizard">
      <header className="wizard-head">
        <button
          className="icon-button"
          aria-label="Back to profiles"
          onClick={() => props.onDone(null)}
        >
          <BackIcon />
        </button>
        <h1>Create profile</h1>
      </header>
      <ol className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={i === step ? 'current' : i < step ? 'done' : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            {s}
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && (
          <>
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                maxLength={60}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Shop account"
              />
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <textarea
                value={notes}
                rows={3}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            {testProxyAvailable && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={testProxy}
                  onChange={(e) => {
                    setTestProxy(e.target.checked);
                    setCheck({ state: 'idle' });
                  }}
                />
                <span>
                  Use the built in test proxy
                  <small>
                    For trying Enclave out. It goes out through this PC&apos;s own connection, so it
                    is not for real accounts.
                  </small>
                </span>
              </label>
            )}
            {!testProxy && (
              <label className="field">
                <span>Proxy</span>
                <input
                  className="mono"
                  value={proxy}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => {
                    setProxy(e.target.value);
                    if (check.state !== 'checking') setCheck({ state: 'idle' });
                  }}
                  placeholder="socks5://user:pass@host:port"
                />
                <small>Paste it in any of these forms: {PROXY_FORMATS}.</small>
              </label>
            )}
            <div className="row">
              <button
                className="button"
                onClick={() => void runCheck()}
                disabled={check.state === 'checking' || (!testProxy && !proxy.trim())}
              >
                {check.state === 'checking' ? 'Checking proxy' : 'Check proxy'}
              </button>
              {check.state === 'checking' && (
                <span className="muted">This takes a few seconds.</span>
              )}
            </div>
            {check.state === 'ok' && checked && <CheckResult result={check.result} />}
            {check.state === 'failed' && <p className="notice error">{check.message}</p>}
          </>
        )}

        {step === 2 && (
          <div className="choice selected" aria-label="Device">
            <strong>Auto</strong>
            <p>
              A Windows PC with this computer&apos;s graphics card, the fonts and settings of
              Windows Firefox, and a screen size picked from those real Windows users have. Enclave
              picks the rest from real devices too, and keeps all of it fixed for this profile.
            </p>
          </div>
        )}

        {step === 3 && check.state === 'ok' && (
          <>
            <dl className="facts review">
              <dt>Name</dt>
              <dd>{name.trim()}</dd>
              <dt>Proxy</dt>
              <dd className="mono">{testProxy ? 'Built in test proxy' : redact(proxy.trim())}</dd>
              <dt>Exit IP</dt>
              <dd>
                <Flag code={check.result.country} />{' '}
                <span className="mono">{check.result.exitIp}</span>
              </dd>
              <dt>Location</dt>
              <dd>
                {countryName(check.result.country)}, {check.result.timezone}
              </dd>
              <dt>Device</dt>
              <dd>Auto, Windows</dd>
            </dl>
            <p className="notice">
              The profile&apos;s time zone, language and location will match{' '}
              {countryName(check.result.country)}. Its device fingerprint is made once now and never
              changes.
            </p>
            {error && <p className="notice error">{error}</p>}
          </>
        )}
      </div>

      <footer className="wizard-foot">
        {step > 0 && (
          <button className="button quiet" onClick={() => setStep(step - 1)} disabled={creating}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="button primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
            Continue
          </button>
        ) : (
          <button className="button primary" onClick={() => void create()} disabled={creating}>
            {creating ? 'Creating profile' : 'Create profile'}
          </button>
        )}
        {creating && (
          <span className="muted">
            Checking the proxy again and making the fingerprint. This takes up to a minute.
          </span>
        )}
        {step === 1 && !checked && check.state !== 'checking' && (
          <span className="muted">Check the proxy to continue.</span>
        )}
      </footer>
    </section>
  );
}

function CheckResult({ result }: { result: ProxyCheckResult }) {
  return (
    <div className="check-ok">
      <strong>Proxy works</strong>
      <dl className="facts">
        <dt>Exit IP</dt>
        <dd>
          <Flag code={result.country} /> <span className="mono">{result.exitIp}</span>
        </dd>
        <dt>Country</dt>
        <dd>{countryName(result.country)}</dd>
        <dt>Time zone</dt>
        <dd>{result.timezone}</dd>
        {result.latencyMs !== undefined && (
          <>
            <dt>Response</dt>
            <dd className="mono">{result.latencyMs} ms</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** The proxy as typed, with its password hidden. */
function redact(spec: string): string {
  const url = /^([a-z0-9]+:\/\/[^:@/]+):[^@]*@/i;
  if (url.test(spec)) return spec.replace(url, '$1:•••@');
  const parts = spec.split(':');
  if (parts.length === 4) return `${parts[0]}:${parts[1]}:${parts[2]}:•••`;
  return spec;
}

// ---------------------------------------------------------------- edit

export function EditProfile(props: { profile: Profile; running: boolean; onDone(): void }) {
  const p = props.profile;
  const [name, setName] = useState(p.name);
  const [notes, setNotes] = useState(p.notes ?? '');
  const [idle, setIdle] = useState(String(p.runtime.idleStopMinutes ?? 20));
  const [changeProxy, setChangeProxy] = useState(false);
  const [proxy, setProxy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const minutes = Number(idle);
    const body: UpdateProfileRequest = {
      ...(name.trim() !== p.name ? { name: name.trim() } : {}),
      ...(notes.trim() !== (p.notes ?? '') ? { notes: notes.trim() } : {}),
      ...(minutes !== p.runtime.idleStopMinutes ? { idleStopMinutes: minutes } : {}),
      ...(changeProxy && proxy.trim() ? { proxy: proxy.trim() } : {}),
    };
    try {
      await api<Profile>('PATCH', `/profiles/${p.id}`, body);
      props.onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'PROXY_LOCATION_MISMATCH') {
        setError(
          `${e.message.replace(/ Not starting.*$/, '')} Use a proxy in the profile's own country, or create a new profile for the new location.`,
        );
      } else setError(nextStep(e));
      setSaving(false);
    }
  };

  const idleOk = /^\d+$/.test(idle) && Number(idle) >= 1 && Number(idle) <= 1440;

  return (
    <section className="page wizard">
      <header className="wizard-head">
        <button className="icon-button" aria-label="Back to profiles" onClick={props.onDone}>
          <BackIcon />
        </button>
        <h1>Edit {p.name}</h1>
      </header>
      <div className="wizard-body">
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea
            value={notes}
            rows={3}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="field narrow">
          <span>Stop after this many idle minutes</span>
          <input value={idle} inputMode="numeric" onChange={(e) => setIdle(e.target.value)} />
          {!idleOk && <small className="error-text">A whole number from 1 to 1440.</small>}
        </label>
        <div className="field">
          <span>Proxy</span>
          <p className="mono">
            {p.runtime.usesTestProxy
              ? 'Built in test proxy'
              : `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`}
          </p>
          {!changeProxy ? (
            <button
              className="button small"
              onClick={() => setChangeProxy(true)}
              disabled={props.running}
              title={props.running ? 'Stop the profile to change its proxy.' : undefined}
            >
              Change proxy
            </button>
          ) : (
            <>
              <input
                className="mono"
                value={proxy}
                autoFocus
                spellCheck={false}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="socks5://user:pass@host:port"
              />
              <small>
                The new proxy must be in the same country and time zone as the profile. Saving
                checks it first.
              </small>
            </>
          )}
          {props.running && <small>Stop the profile to change its proxy.</small>}
        </div>
        {error && <p className="notice error">{error}</p>}
      </div>
      <footer className="wizard-foot">
        <button className="button quiet" onClick={props.onDone} disabled={saving}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() => void save()}
          disabled={saving || !name.trim() || !idleOk}
        >
          {saving ? 'Saving' : 'Save changes'}
        </button>
        {saving && changeProxy && proxy.trim() && (
          <span className="muted">Checking the new proxy.</span>
        )}
      </footer>
    </section>
  );
}

// Screen 5 (ui/screens.md): settings, resource use, and what the app is made of.

import { useEffect, useState } from 'react';
import type { Profile, SystemResponse } from '@enclave/shared';
import type { AppSettingsView, PhoneMode } from '../shared/bridge';
import { api } from './api';
import { RelayPanel } from './Phone';

const PHONE_CHOICES: [PhoneMode, string, string][] = [
  [
    'relay',
    'Through your Enclave relay',
    'Works on any network. Each phone pairs once by scanning a QR code.',
  ],
  [
    'tailscale',
    'Over Tailscale',
    'Needs Tailscale on this PC and the phone, signed in to the same account.',
  ],
  ['off', 'Off', 'No phone can open profiles on this PC.'],
];

/** Open source parts Enclave ships, with their licences. */
const NOTICES: [string, string][] = [
  ['Camoufox (Firefox)', 'MPL 2.0'],
  ['neko', 'Apache 2.0'],
  ['uBlock Origin', 'GPL 3.0'],
  ['gost', 'MIT'],
  ['Electron', 'MIT'],
  ['Chromium', 'BSD 3-Clause and others'],
  ['Node.js', 'MIT'],
  ['React', 'MIT'],
  ['Fastify', 'MIT'],
  ['dockerode', 'Apache 2.0'],
  ['Inter', 'SIL Open Font License 1.1'],
  ['IBM Plex Mono', 'SIL Open Font License 1.1'],
  ['flag-icons', 'MIT'],
];

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function Settings({ profiles }: { profiles: Profile[] | null }) {
  const [view, setView] = useState<AppSettingsView | null>(null);
  const [idle, setIdle] = useState('');
  const [proxy, setProxy] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemResponse | null>(null);

  useEffect(() => {
    void window.enclave.settings().then((v) => {
      setView(v);
      setIdle(String(v.idleMinutes));
      setProxy(v.defaultProxy);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SystemResponse>('GET', '/system').then(
        (s) => alive && setSystem(s),
        () => {},
      );
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const save = async (what: string, change: Parameters<typeof window.enclave.saveSettings>[0]) => {
    setSaving(what);
    setSaved(null);
    setError(null);
    try {
      await window.enclave.saveSettings(change);
      setView(await window.enclave.settings());
      setSaved(what);
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      );
    } finally {
      setSaving(null);
    }
  };

  if (!view) {
    return (
      <section className="page">
        <h1>Settings</h1>
      </section>
    );
  }

  const idleOk = /^\d+$/.test(idle) && Number(idle) >= 1 && Number(idle) <= 1440;
  const names = new Map(profiles?.map((p) => [p.id, p.name]));
  const used = system?.profileMemory.reduce((sum, m) => sum + (m.bytes ?? 0), 0) ?? 0;

  return (
    <section className="page">
      <div className="settings">
        <h1>Settings</h1>
        {error && <p className="notice error">{error}</p>}

        <section className="settings-group" aria-labelledby="s-profiles">
          <h2 id="s-profiles">New profiles</h2>
          <label className="field narrow">
            <span>Stop a profile after it sits idle for this many minutes</span>
            <input value={idle} inputMode="numeric" onChange={(e) => setIdle(e.target.value)} />
            {!idleOk && <small className="error-text">A whole number from 1 to 1440.</small>}
            <small>Each profile can change its own in Edit.</small>
          </label>
          <label className="field">
            <span>Default proxy</span>
            <input
              className="mono"
              value={proxy}
              spellCheck={false}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="socks5://user:pass@host:port"
            />
            <small>Create profile starts with this proxy. Kept encrypted on this PC.</small>
          </label>
          <div className="row">
            <button
              className="button"
              disabled={!idleOk || saving !== null}
              onClick={() =>
                void save('profiles', { idleMinutes: Number(idle), defaultProxy: proxy })
              }
            >
              {saving === 'profiles' ? 'Saving' : 'Save'}
            </button>
            {saved === 'profiles' && <span className="muted">Saved.</span>}
          </div>
        </section>

        <section className="settings-group" aria-labelledby="s-phone">
          <h2 id="s-phone">Phone access</h2>
          <div className="choices" role="radiogroup" aria-labelledby="s-phone">
            {PHONE_CHOICES.map(([mode, title, detail]) => (
              <label className="toggle" key={mode}>
                <input
                  type="radio"
                  name="phone"
                  checked={view.phone === mode}
                  disabled={saving !== null}
                  onChange={() => void save('phone', { phone: mode })}
                />
                <span>
                  {title}
                  <small>{detail}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="muted small">A change applies to profiles started after it.</p>
          {saving === 'phone' && <p className="muted">Restarting Enclave&apos;s service.</p>}
          {view.phone === 'relay' && saving !== 'phone' && <RelayPanel profiles={profiles} />}
        </section>

        <section className="settings-group" aria-labelledby="s-use">
          <h2 id="s-use">Resource use</h2>
          {system ? (
            <dl className="facts">
              {system.profileMemory.map((m) => (
                <div className="contents" key={m.id}>
                  <dt>{names.get(m.id) ?? 'Profile'}</dt>
                  <dd className="mono">{m.bytes === null ? 'Unknown' : gb(m.bytes)}</dd>
                </div>
              ))}
              {system.profileMemory.length === 0 && (
                <>
                  <dt>Profiles</dt>
                  <dd>None running</dd>
                </>
              )}
              <dt>All profiles</dt>
              <dd className="mono">{gb(used)}</dd>
              <dt>This PC</dt>
              <dd className="mono">
                {gb(system.ram.totalBytes - system.ram.freeBytes)} of {gb(system.ram.totalBytes)} in
                use
              </dd>
            </dl>
          ) : (
            <p className="muted">Reading.</p>
          )}
        </section>

        <section className="settings-group" aria-labelledby="s-data">
          <h2 id="s-data">Data</h2>
          <p className="mono small">{view.dataFolder}</p>
          <p className="muted">
            Profiles, their settings and encrypted passwords. Each profile&apos;s browser data
            (tabs, logins, history) lives in Docker.
          </p>
          <div className="row">
            <button className="button" onClick={() => void window.enclave.openDataFolder()}>
              Open folder
            </button>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="s-about">
          <h2 id="s-about">About</h2>
          <dl className="facts">
            <dt>Enclave</dt>
            <dd className="mono">{view.versions.app}</dd>
            <dt>Electron</dt>
            <dd className="mono">{view.versions.electron}</dd>
            <dt>Chromium</dt>
            <dd className="mono">{view.versions.chromium}</dd>
            <dt>Node.js</dt>
            <dd className="mono">{view.versions.node}</dd>
          </dl>
          <h3 className="notices-head">Third party notices</h3>
          <dl className="facts notices">
            {NOTICES.map(([name, licence]) => (
              <div className="contents" key={name}>
                <dt>{name}</dt>
                <dd>{licence}</dd>
              </div>
            ))}
          </dl>
          <div className="row">
            <button className="button" onClick={() => void window.enclave.openNotices()}>
              Open full list
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

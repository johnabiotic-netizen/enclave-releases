// Settings, phone access through the Enclave relay (Stage 6): sign in, pair a phone with a QR
// code, choose which profiles each phone may open, and see or unpair the phones paired with
// this PC.

import { useCallback, useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import type {
  PairedPhone,
  PhoneProfiles,
  Profile,
  RelayPairingResponse,
  RelaySignInRequest,
  RelayStatus,
} from '@enclave/shared';
import { api } from './api';

const POLL_MS = 3000;
const PAIRING_POLL_MS = 1500;

function when(iso: string | null): string {
  if (!iso) return 'not seen yet';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function RelayPanel({ profiles }: { profiles: Profile[] | null }) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{
    svg: string;
    expiresAt: number;
    known: string[];
  } | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  /** Pairing, step one: which profiles the new phone may open (none chosen yet). */
  const [choosing, setChoosing] = useState<PhoneProfiles | null>(null);
  /** A paired phone whose profiles are being changed, with the choice so far. */
  const [editing, setEditing] = useState<{ id: string; profiles: PhoneProfiles } | null>(null);
  const names = new Map(profiles?.map((p) => [p.id, p.name]));

  const load = useCallback(async () => {
    try {
      setStatus(await api<RelayStatus>('GET', '/relay'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), pairing ? PAIRING_POLL_MS : POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, pairing]);

  // A phone that appears while the QR code is up has just paired.
  useEffect(() => {
    if (!pairing || !status) return;
    const fresh = status.devices.find((d) => !pairing.known.includes(d.id));
    if (fresh) {
      setPairing(null);
      setPaired(fresh.name);
    }
  }, [status, pairing]);

  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setPaired(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pair = (scope: PhoneProfiles) =>
    run('pair', async () => {
      const res = await api<RelayPairingResponse>('POST', '/relay/pairing', {
        profiles: scope,
      });
      setChoosing(null);
      const qr = qrcode(0, 'M');
      qr.addData(res.link);
      qr.make();
      setPairing({
        svg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }),
        expiresAt: Date.parse(res.expiresAt),
        known: status?.devices.map((d) => d.id) ?? [],
      });
    });

  if (!status) return <p className="muted">Reading.</p>;

  if (!status.signedIn) {
    return (
      <SignIn
        busy={busy !== null}
        error={error}
        onSubmit={(req) =>
          run('sign-in', async () => {
            setStatus(await api<RelayStatus>('POST', '/relay/sign-in', req));
          })
        }
      />
    );
  }

  return (
    <div className="relay">
      {error && <p className="notice error">{error}</p>}
      <dl className="facts">
        <dt>Link</dt>
        <dd className="mono">{status.url}</dd>
        <dt>Account</dt>
        <dd>{status.email}</dd>
        <dt>This PC</dt>
        <dd>{status.pcName}</dd>
        <dt>Status</dt>
        <dd>
          {status.connected ? (
            <span className="ok-text">Connected</span>
          ) : (
            (status.problem ?? 'Connecting')
          )}
        </dd>
      </dl>

      {choosing && !pairing ? (
        <div className="choose">
          <p>Which profiles can this phone open?</p>
          <ProfilePicker profiles={profiles} value={choosing} onChange={setChoosing} />
          <div className="row">
            <button
              className="button primary"
              disabled={busy !== null || (choosing !== 'all' && choosing.length === 0)}
              onClick={() => void pair(choosing)}
            >
              {busy === 'pair' ? 'Making a code' : 'Show QR code'}
            </button>
            <button className="button quiet" onClick={() => setChoosing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : pairing ? (
        <Pairing
          svg={pairing.svg}
          expiresAt={pairing.expiresAt}
          onExpired={() => setPairing(null)}
          onCancel={() => setPairing(null)}
        />
      ) : (
        <div className="row">
          <button
            className="button primary"
            disabled={busy !== null || !status.connected}
            onClick={() => {
              setPaired(null);
              setChoosing([]);
            }}
          >
            Pair a phone
          </button>
          {paired && <span className="ok-text">Paired with {paired}.</span>}
        </div>
      )}

      <h3 className="notices-head">Paired phones</h3>
      {status.devices.length === 0 ? (
        <p className="muted">No phones yet.</p>
      ) : (
        <ul className="phones">
          {status.devices.map((d: PairedPhone) => (
            <li key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <small>
                  Paired {when(d.pairedAt)}. Last seen {when(d.lastSeenAt)}.
                </small>
                <small>Opens {opens(d.profiles, names)}.</small>
                {editing?.id === d.id && (
                  <div className="choose">
                    <ProfilePicker
                      profiles={profiles}
                      value={editing.profiles}
                      onChange={(v) => setEditing({ id: d.id, profiles: v })}
                    />
                    <div className="row">
                      <button
                        className="button small primary"
                        disabled={
                          busy !== null ||
                          (editing.profiles !== 'all' && editing.profiles.length === 0)
                        }
                        onClick={() =>
                          void run('profiles', async () => {
                            await api('PATCH', `/relay/devices/${encodeURIComponent(d.id)}`, {
                              profiles: editing.profiles,
                            });
                            setEditing(null);
                          })
                        }
                      >
                        Save
                      </button>
                      <button className="button small quiet" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                    <small>A profile you take away closes on the phone at once.</small>
                  </div>
                )}
              </div>
              {editing?.id === d.id ? null : confirm === d.id ? (
                <div className="row">
                  <span className="muted small">It loses access at once.</span>
                  <button
                    className="button small danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('unpair', async () => {
                        await api('DELETE', `/relay/devices/${encodeURIComponent(d.id)}`);
                        setConfirm(null);
                      })
                    }
                  >
                    Unpair
                  </button>
                  <button className="button small quiet" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <div className="row">
                  <button
                    className="button small"
                    onClick={() => {
                      setConfirm(null);
                      setEditing({ id: d.id, profiles: d.profiles });
                    }}
                  >
                    Change
                  </button>
                  <button className="button small" onClick={() => setConfirm(d.id)}>
                    Unpair
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        {confirm === 'sign-out' ? (
          <>
            <span className="muted small">Signing out unpairs every phone.</span>
            <button
              className="button small danger"
              disabled={busy !== null}
              onClick={() =>
                void run('sign-out', async () => {
                  await api('POST', '/relay/sign-out');
                  setConfirm(null);
                })
              }
            >
              Sign out
            </button>
            <button className="button small quiet" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="button small quiet" onClick={() => setConfirm('sign-out')}>
            Sign out of Link
          </button>
        )}
      </div>
    </div>
  );
}

function SignIn(props: {
  busy: boolean;
  error: string | null;
  onSubmit(req: RelaySignInRequest): void;
}) {
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pcName, setPcName] = useState('');
  const [create, setCreate] = useState(false);
  const [invite, setInvite] = useState('');
  const ready = url.trim() && email.trim() && password && (!create || password.length >= 10);
  return (
    <form
      className="relay"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        props.onSubmit({
          url,
          email,
          password,
          pcName,
          ...(create ? { createAccount: true, ...(invite ? { inviteCode: invite } : {}) } : {}),
        });
      }}
    >
      {props.error && <p className="notice error">{props.error}</p>}
      <label className="field">
        <span>Link address</span>
        <input
          className="mono"
          value={url}
          spellCheck={false}
          placeholder="link.example.com"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          autoComplete={create ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {create && password.length > 0 && password.length < 10 && (
          <small className="error-text">At least 10 characters.</small>
        )}
        <small>Sent to Link once to sign this PC in. Not kept on this PC.</small>
      </label>
      <label className="field">
        <span>This PC&apos;s name</span>
        <input
          value={pcName}
          maxLength={60}
          placeholder="The Windows name of this PC"
          onChange={(e) => setPcName(e.target.value)}
        />
        <small>Your phone shows it.</small>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
        <span>
          Make a new account with this email
          <small>For the first PC. Other PCs sign in to the same account.</small>
        </span>
      </label>
      {create && (
        <label className="field narrow">
          <span>Invite code</span>
          <input className="mono" value={invite} onChange={(e) => setInvite(e.target.value)} />
          <small>If your Link service asks for one.</small>
        </label>
      )}
      <div className="row">
        <button className="button primary" type="submit" disabled={!ready || props.busy}>
          {props.busy ? 'Signing in' : create ? 'Create account and sign in' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

function Pairing(props: { svg: string; expiresAt: number; onExpired(): void; onCancel(): void }) {
  const [now, setNow] = useState(Date.now());
  const expired = useRef(props.onExpired);
  expired.current = props.onExpired;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((props.expiresAt - now) / 1000));
  useEffect(() => {
    if (left === 0) expired.current();
  }, [left]);
  return (
    <div className="pairing">
      {/* The SVG is drawn here from the pairing link; nothing from outside goes into it. */}
      <div className="qr" dangerouslySetInnerHTML={{ __html: props.svg }} />
      <div>
        <p>Scan this code with your phone&apos;s camera. The phone pairs and opens Enclave.</p>
        <p className="muted small">
          It works once and expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
          Anyone who scans it can pair a phone, so don&apos;t share it.
        </p>
        <button className="button small" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** What a paired phone may open, in words. */
function opens(scope: PhoneProfiles, names: Map<string, string>): string {
  if (scope === 'all') return 'all profiles';
  const shown = scope.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  return shown.length ? shown.join(', ') : 'no profiles';
}

/** All profiles, or a checklist of them. */
function ProfilePicker(props: {
  profiles: Profile[] | null;
  value: PhoneProfiles;
  onChange(v: PhoneProfiles): void;
}) {
  const list = props.profiles ?? [];
  const chosen = props.value === 'all' ? [] : props.value;
  return (
    <div className="picker">
      <label className="toggle">
        <input
          type="radio"
          checked={props.value === 'all'}
          onChange={() => props.onChange('all')}
        />
        <span>
          All profiles
          <small>Including profiles you make later.</small>
        </span>
      </label>
      <label className="toggle">
        <input
          type="radio"
          checked={props.value !== 'all'}
          onChange={() => props.onChange(chosen)}
        />
        <span>Only these profiles</span>
      </label>
      {props.value !== 'all' && (
        <div className="picker-list">
          {list.length === 0 && <p className="muted small">No profiles yet.</p>}
          {list.map((p) => (
            <label className="toggle" key={p.id}>
              <input
                type="checkbox"
                checked={chosen.includes(p.id)}
                onChange={(e) =>
                  props.onChange(
                    e.target.checked ? [...chosen, p.id] : chosen.filter((id) => id !== p.id),
                  )
                }
              />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

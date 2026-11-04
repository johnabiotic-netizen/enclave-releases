// Screen 2, the dashboard (ui/screens.md): every profile as a sealed tile with its status
// seam, and a detail panel for the selected one.

import { useEffect, useRef, useState } from 'react';
import type { DownloadedFile, Profile } from '@enclave/shared';
import { api } from './api';
import { Flag } from './Flag';
import {
  country,
  countryName,
  exitIp,
  lastUsed,
  SEAM,
  STATE_WORD,
  type ShownState,
} from './format';
import { CloseIcon, MoreIcon, PlusIcon } from './icons';
import type { ProfilesModel } from './useProfiles';
import { PROXY_LOST } from './Viewer';
import { ExportDialog, ImportDialog } from './Transfer';
import { CommandBar, filterProfiles, ProxyMatch } from './CommandBar';

interface Props {
  model: ProfilesModel;
  selected: string | null;
  onSelect(id: string | null): void;
  onOpen(id: string): void;
  onCreate(): void;
  onEdit(id: string): void;
  onAudit(id: string): void;
}

export function Dashboard({ model, selected, onSelect, onOpen, onCreate, onEdit, onAudit }: Props) {
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [exporting, setExporting] = useState<Profile | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const pickImport = async () => {
    const name = await window.enclave.pickProfileFile();
    if (name) setImporting(name);
  };
  const { profiles } = model;
  const current = profiles?.find((p) => p.id === selected) ?? null;

  if (!profiles) {
    return (
      <section className="page">
        <h1>Profiles</h1>
        <p className="muted">{model.loadError ?? 'Loading profiles.'}</p>
      </section>
    );
  }

  return (
    <div className="with-panel">
      <section className="page">
        <header className="page-head">
          <h1>Profiles</h1>
          {profiles.length > 0 && (
            <div className="row">
              <button className="button" onClick={() => void pickImport()}>
                Import profile
              </button>
              <button className="button primary" onClick={onCreate}>
                <PlusIcon /> Create profile
              </button>
            </div>
          )}
        </header>
        {profiles.length > 0 && (
          <CommandBar
            value={query}
            onChange={setQuery}
            profiles={profiles}
            isRunning={(p) => model.shownState(p) === 'running'}
            actions={{
              start: (id) => void model.start(id),
              stop: (id) => void model.stop(id),
              open: onOpen,
              edit: onEdit,
              audit: onAudit,
              create: onCreate,
            }}
          />
        )}
        {model.loadError && <p className="notice error">{model.loadError}</p>}
        {profiles.length === 0 ? (
          <div className="empty">
            <p>No profiles yet. Create your first sealed profile to get started.</p>
            <div className="row">
              <button className="button primary" onClick={onCreate}>
                Create profile
              </button>
              <button className="button" onClick={() => void pickImport()}>
                Import a profile file
              </button>
            </div>
          </div>
        ) : (
          <ul className="grid" aria-label="Profiles">
            {filterProfiles(profiles, query).length === 0 && (
              <li className="muted grid-empty">No profile matches &quot;{query.trim()}&quot;.</li>
            )}
            {filterProfiles(profiles, query).map((p) => (
              <Tile
                key={p.id}
                profile={p}
                state={model.shownState(p)}
                selected={p.id === selected}
                error={model.actionError[p.id]}
                moved={Boolean(model.moved[p.id])}
                onUpdateLocation={() => void model.updateLocation(p.id)}
                onSelect={() => onSelect(p.id)}
                onStart={() => void model.start(p.id)}
                onOpen={() => onOpen(p.id)}
                onStop={() => void model.stop(p.id)}
                onEdit={() => onEdit(p.id)}
                onDelete={() => setDeleting(p)}
                onExport={() => setExporting(p)}
                onAudit={() => onAudit(p.id)}
              />
            ))}
          </ul>
        )}
      </section>
      {current && (
        <Details
          profile={current}
          state={model.shownState(current)}
          error={model.actionError[current.id]}
          moved={Boolean(model.moved[current.id])}
          onClose={() => onSelect(null)}
          onStart={() => void model.start(current.id)}
          onOpen={() => onOpen(current.id)}
          onStop={() => void model.stop(current.id)}
          onEdit={() => onEdit(current.id)}
        />
      )}
      {exporting && <ExportDialog profile={exporting} onClose={() => setExporting(null)} />}
      {importing && (
        <ImportDialog
          fileName={importing}
          onClose={() => setImporting(null)}
          onImported={(id) => {
            void model.refresh();
            onSelect(id);
          }}
        />
      )}
      {deleting && (
        <ConfirmDelete
          profile={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            if (selected === id) onSelect(null);
            void model.remove(id);
          }}
        />
      )}
    </div>
  );
}

interface TileProps {
  profile: Profile;
  state: ShownState;
  selected: boolean;
  error: string | undefined;
  moved: boolean;
  onUpdateLocation(): void;
  onSelect(): void;
  onStart(): void;
  onOpen(): void;
  onStop(): void;
  onEdit(): void;
  onDelete(): void;
  onExport(): void;
  onAudit(): void;
}

function Tile({ profile: p, state, selected, error, moved, ...on }: TileProps) {
  const busy = state === 'starting' || state === 'stopping';
  const ip = exitIp(p);
  return (
    <li className={`tile ${SEAM[state]}${selected ? ' selected' : ''}`}>
      <span className="seam" aria-hidden="true" />
      <button className="tile-body" onClick={on.onSelect} aria-pressed={selected}>
        <span className="tile-name">{p.name}</span>
        <span className="tile-state">{STATE_WORD[state]}</span>
        <span className="tile-ip">
          <Flag code={country(p)} />
          <span className="mono">{ip ?? 'No exit IP yet'}</span>
        </span>
        <span className="tile-used muted">{lastUsed(p)}</span>
        {error && <span className="tile-error">{error}</span>}
        {!error && state === 'running' && p.status.lastError === PROXY_LOST && (
          <span className="tile-error">Proxy unreachable, pages will not load.</span>
        )}
      </button>
      <div className="tile-actions">
        {moved && state === 'stopped' ? (
          <button className="button small" onClick={on.onUpdateLocation}>
            Update location
          </button>
        ) : state === 'running' ? (
          <button className="button primary small" onClick={on.onOpen}>
            Open
          </button>
        ) : (
          <button className="button small" onClick={on.onStart} disabled={busy}>
            {state === 'starting' ? 'Starting' : state === 'stopping' ? 'Stopping' : 'Start'}
          </button>
        )}
        <TileMenu
          name={p.name}
          running={state === 'running'}
          busy={busy}
          onStop={on.onStop}
          onEdit={on.onEdit}
          onDelete={on.onDelete}
          onExport={on.onExport}
          onAudit={on.onAudit}
        />
      </div>
    </li>
  );
}

function TileMenu(props: {
  name: string;
  running: boolean;
  busy: boolean;
  onStop(): void;
  onEdit(): void;
  onDelete(): void;
  onExport(): void;
  onAudit(): void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="menu" ref={box}>
      <button
        className="icon-button"
        aria-label={`More for ${props.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {props.running && (
            <button role="menuitem" onClick={pick(props.onStop)}>
              Stop
            </button>
          )}
          <button role="menuitem" onClick={pick(props.onEdit)} disabled={props.busy}>
            Edit
          </button>
          <button role="menuitem" onClick={pick(props.onAudit)} disabled={props.busy}>
            Check fingerprint
          </button>
          <button
            role="menuitem"
            onClick={pick(props.onExport)}
            disabled={props.running || props.busy}
            title={props.running ? 'Stop the profile before exporting it.' : undefined}
          >
            Export
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={pick(props.onDelete)}
            disabled={props.running || props.busy}
            title={props.running ? 'Stop the profile before deleting it.' : undefined}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Details(props: {
  profile: Profile;
  state: ShownState;
  error: string | undefined;
  moved: boolean;
  onClose(): void;
  onStart(): void;
  onOpen(): void;
  onStop(): void;
  onEdit(): void;
}) {
  const { profile: p, state } = props;
  const check = p.proxy.lastCheck;
  const fp = p.fingerprint;
  const busy = state === 'starting' || state === 'stopping';
  const place = [check?.city, countryName(check?.country)].filter(Boolean).join(', ');
  return (
    <aside className={`panel ${SEAM[state]}`} aria-label={`${p.name} details`}>
      <header className="panel-head">
        <div>
          <h2>{p.name}</h2>
          <p className="panel-state">
            <span className="dot" aria-hidden="true" /> {STATE_WORD[state]}
          </p>
        </div>
        <button className="icon-button" aria-label="Close details" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="panel-actions">
        {state === 'running' ? (
          <>
            <button className="button primary" onClick={props.onOpen}>
              Open
            </button>
            <button className="button" onClick={props.onStop}>
              Stop
            </button>
          </>
        ) : (
          <button className="button primary" onClick={props.onStart} disabled={busy}>
            {state === 'starting' ? 'Starting' : 'Start profile'}
          </button>
        )}
        <button className="button quiet" onClick={props.onEdit} disabled={busy}>
          Edit
        </button>
      </div>
      {(props.error || (state === 'error' && p.status.lastError)) && (
        <p className="notice error">{props.error ?? p.status.lastError}</p>
      )}
      <ProxyMatch profile={p} moved={props.moved} />
      <dl className="facts">
        <dt>Exit IP</dt>
        <dd>
          <Flag code={check?.country} />{' '}
          <span className="mono">{check?.exitIp ?? 'Not checked yet'}</span>
        </dd>
        {place && (
          <>
            <dt>Location</dt>
            <dd>{place}</dd>
          </>
        )}
        <dt>Proxy</dt>
        <dd className="mono">
          {p.proxy.type}://{p.proxy.host}:{p.proxy.port}
        </dd>
        <dt>Time zone</dt>
        <dd>{fp.timezone}</dd>
        <dt>Language</dt>
        <dd>{fp.locale}</dd>
        <dt>Screen</dt>
        <dd className="mono">
          {fp.screen.width} x {fp.screen.height}
        </dd>
        {fp.webgl?.renderer && (
          <>
            <dt>Graphics</dt>
            <dd>{fp.webgl.renderer.replace(/^ANGLE \((.*)\).*$/, '$1')}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{new Date(p.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</dd>
        <dt>Profile id</dt>
        <dd className="mono small">{p.id}</dd>
      </dl>
      {state === 'running' && <Downloads profileId={p.id} />}
      {p.runtime.usesTestProxy && (
        <p className="notice">
          Test proxy. This profile goes out through this PC&apos;s own connection. Not for real
          accounts.
        </p>
      )}
      {p.notes && <p className="notes">{p.notes}</p>}
    </aside>
  );
}

function ConfirmDelete(props: { profile: Profile; onCancel(): void; onConfirm(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={props.onCancel} aria-labelledby="delete-title">
      <h2 id="delete-title">Delete {props.profile.name}?</h2>
      <p>
        Its tabs, logins and history are deleted with it, and its device fingerprint is gone for
        good. This can&apos;t be undone.
      </p>
      <div className="dialog-actions">
        <button className="button" onClick={props.onCancel} autoFocus>
          Keep profile
        </button>
        <button className="button danger" onClick={props.onConfirm}>
          Delete profile
        </button>
      </div>
    </dialog>
  );
}

/** What a running profile downloaded, with Save to PC (into this PC's Downloads folder). */
function Downloads({ profileId }: { profileId: string }) {
  const [files, setFiles] = useState<DownloadedFile[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<DownloadedFile[]>('GET', `/profiles/${profileId}/downloads`).then(
        (list) => alive && setFiles(list),
        () => {},
      );
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [profileId]);

  if (!files || files.length === 0) return null;
  const save = async (f: DownloadedFile) => {
    setBusy(f.name);
    setError(null);
    try {
      const { path } = await window.enclave.saveDownload(profileId, f.name);
      setSaved((s) => ({ ...s, [f.name]: path }));
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="downloads" aria-label="Downloads">
      <h3 className="notices-head">Downloads</h3>
      {error && <p className="notice error">{error}</p>}
      <ul>
        {files.map((f) => (
          <li key={f.name}>
            <div>
              <span className="name">{f.name}</span>
              <small>{fileSize(f.bytes)}</small>
            </div>
            {saved[f.name] ? (
              <button
                className="button small quiet"
                onClick={() => void window.enclave.showInFolder(saved[f.name]!)}
              >
                Show in folder
              </button>
            ) : (
              <button
                className="button small"
                disabled={busy !== null}
                onClick={() => void save(f)}
              >
                {busy === f.name ? 'Saving' : 'Save to PC'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The app shell (ui/design-system.md, Layout): a slim left rail, the main area, and a detail
// panel when a profile is selected.

import { useEffect, useState } from 'react';
import type { AgentState } from '../shared/bridge';
import { Dashboard } from './Dashboard';
import { ProfilesIcon, SettingsIcon, SetupIcon } from './icons';
import { useProfiles } from './useProfiles';
import { Settings } from './Settings';
import { Viewer } from './Viewer';
import { CreateWizard, EditProfile } from './Wizard';

type View =
  | { kind: 'profiles' }
  | { kind: 'viewer'; id: string }
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'settings' }
  | { kind: 'setup' };

export function App() {
  const [agent, setAgent] = useState<AgentState>({ status: 'starting' });
  // Once the app has run, a restart of its service (a settings change) keeps the screens.
  const [phoneApp, setPhoneApp] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const take = (s: AgentState) => {
      setAgent(s);
      if (s.status === 'running') setPhoneApp(s.phoneApp);
    };
    void window.enclave.agentState().then(take);
    return window.enclave.onAgentState(take);
  }, []);

  if (phoneApp === undefined) {
    return (
      <div className="splash">
        {agent.status === 'failed' ? (
          <>
            <h1>Enclave could not start</h1>
            <p>{agent.message}</p>
          </>
        ) : (
          <p>Starting Enclave.</p>
        )}
      </div>
    );
  }
  return (
    <>
      {agent.status !== 'running' && (
        <p className={`service-banner${agent.status === 'failed' ? ' error' : ''}`}>
          {agent.status === 'failed'
            ? `Enclave's service stopped: ${agent.message}`
            : "Enclave's service is restarting."}
        </p>
      )}
      <Shell phoneApp={phoneApp} />
    </>
  );
}

function Shell({ phoneApp }: { phoneApp: string | null }) {
  const [view, setView] = useState<View>({ kind: 'profiles' });
  const [selected, setSelected] = useState<string | null>(null);
  const model = useProfiles();
  const nav = (kind: 'profiles' | 'settings' | 'setup') => setView({ kind });
  const on = (kind: View['kind']) =>
    view.kind === kind || (kind === 'profiles' && ['viewer', 'create', 'edit'].includes(view.kind));

  return (
    <div className="shell">
      <nav className="rail" aria-label="Enclave">
        <span className="brand" aria-hidden="true" />
        <RailButton label="Profiles" active={on('profiles')} onClick={() => nav('profiles')}>
          <ProfilesIcon />
        </RailButton>
        <RailButton label="Settings" active={on('settings')} onClick={() => nav('settings')}>
          <SettingsIcon />
        </RailButton>
        <RailButton label="Setup" active={on('setup')} onClick={() => nav('setup')}>
          <SetupIcon />
        </RailButton>
      </nav>
      <main className="main">
        {view.kind === 'profiles' && (
          <Dashboard
            model={model}
            selected={selected}
            onSelect={setSelected}
            onOpen={(id) => setView({ kind: 'viewer', id })}
            onCreate={() => setView({ kind: 'create' })}
            onEdit={(id) => setView({ kind: 'edit', id })}
          />
        )}
        {view.kind === 'create' && (
          <CreateWizard
            onDone={(id) => {
              void model.refresh();
              if (id) setSelected(id);
              nav('profiles');
            }}
          />
        )}
        {view.kind === 'edit' &&
          (() => {
            const profile = model.profiles?.find((p) => p.id === view.id);
            if (!profile) return null;
            return (
              <EditProfile
                profile={profile}
                running={
                  model.shownState(profile) !== 'stopped' && model.shownState(profile) !== 'error'
                }
                onDone={() => {
                  void model.refresh();
                  nav('profiles');
                }}
              />
            );
          })()}
        {view.kind === 'viewer' &&
          (() => {
            const profile = model.profiles?.find((p) => p.id === view.id);
            if (!profile) return null;
            return (
              <Viewer
                profile={profile}
                state={model.shownState(profile)}
                phoneApp={phoneApp}
                onBack={() => nav('profiles')}
                onStart={() => void model.start(profile.id)}
                onStop={() => void model.stop(profile.id)}
              />
            );
          })()}
        {view.kind === 'settings' && <Settings profiles={model.profiles} />}
        {view.kind === 'setup' && (
          <section className="page">
            <h1>{TITLES[view.kind as keyof typeof TITLES]}</h1>
            <p className="muted">This screen is being built.</p>
            <button className="button" onClick={() => nav('profiles')}>
              Back to profiles
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

const TITLES: Record<Exclude<View['kind'], 'profiles'>, string> = {
  viewer: 'Profile',
  create: 'Create profile',
  edit: 'Edit profile',
  settings: 'Settings',
  setup: 'Setup',
};

function RailButton(props: {
  label: string;
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rail-button${props.active ? ' active' : ''}`}
      onClick={props.onClick}
      aria-current={props.active ? 'page' : undefined}
      title={props.label}
    >
      {props.children}
      <span className="rail-label">{props.label}</span>
    </button>
  );
}

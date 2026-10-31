import { useEffect, useState } from 'react';
import type { Profile } from '@enclave/shared';
import type { AgentState } from '../shared/bridge';
import { api } from './api';

export function App() {
  const [agent, setAgent] = useState<AgentState>({ status: 'starting' });
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.enclave.agentState().then(setAgent);
    return window.enclave.onAgentState(setAgent);
  }, []);

  useEffect(() => {
    if (agent.status !== 'running') return;
    const load = () =>
      api<Profile[]>('GET', '/profiles').then(
        (list) => (setProfiles(list), setError(null)),
        (e: Error) => setError(e.message),
      );
    void load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [agent.status]);

  if (agent.status === 'starting') return <p style={{ padding: 24 }}>Starting Enclave.</p>;
  if (agent.status === 'failed') return <p style={{ padding: 24 }}>{agent.message}</p>;
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 16px' }}>Profiles</h1>
      {error && <p>{error}</p>}
      <ul>
        {profiles?.map((p) => (
          <li key={p.id}>
            {p.name} · {p.status.state} ·{' '}
            <span className="mono">{p.proxy.lastCheck?.exitIp ?? ''}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

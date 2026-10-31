// The profile list, kept fresh while the app is open, plus the actions on a profile. An action
// in progress shows at once (the seam turns amber) while the agent works.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '@enclave/shared';
import { api } from './api';
import type { ShownState } from './format';

const REFRESH_MS = 2000;

export interface ProfilesModel {
  profiles: Profile[] | null;
  loadError: string | null;
  /** Errors from the last action, per profile, in the agent's words. */
  actionError: Record<string, string>;
  shownState(p: Profile): ShownState;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
  clearError(id: string): void;
}

export function useProfiles(): ProfilesModel {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, 'starting' | 'stopping'>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api<Profile[]>('GET', '/profiles');
      if (!alive.current) return;
      setProfiles(list);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const act = useCallback(
    async (id: string, kind: 'starting' | 'stopping' | null, call: () => Promise<unknown>) => {
      if (kind) setBusy((b) => ({ ...b, [id]: kind }));
      setActionError((m) => without(m, id));
      try {
        await call();
      } catch (e) {
        setActionError((m) => ({ ...m, [id]: (e as Error).message }));
      } finally {
        setBusy((m) => without(m, id));
        await refresh();
      }
    },
    [refresh],
  );

  return {
    profiles,
    loadError,
    actionError,
    shownState: (p) => busy[p.id] ?? p.status.state,
    start: (id) => act(id, 'starting', () => api('POST', `/profiles/${id}/start`)),
    stop: (id) => act(id, 'stopping', () => api('POST', `/profiles/${id}/stop`)),
    remove: (id) => act(id, null, () => api('DELETE', `/profiles/${id}?confirm=true`)),
    refresh,
    clearError: (id) => setActionError((m) => without(m, id)),
  };
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map };
  delete next[id];
  return next;
}

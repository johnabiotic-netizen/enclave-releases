// The profile list, kept fresh while the app is open, plus the actions on a profile. An action
// in progress shows at once (the seam turns amber) while the agent works.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '@enclave/shared';
import { api, ApiFailure } from './api';
import { countryName, type ShownState } from './format';

const REFRESH_MS = 2000;

export interface ProfilesModel {
  profiles: Profile[] | null;
  loadError: string | null;
  /** Errors from the last action, per profile, in the agent's words. */
  actionError: Record<string, string>;
  /** Profiles whose start was refused because their proxy now exits in another country. */
  moved: Record<string, true>;
  /** "Update location", then start. */
  updateLocation(id: string): Promise<void>;
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
  const [moved, setMoved] = useState<Record<string, true>>({});
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
      setMoved((m) => without(m, id));
      try {
        await call();
      } catch (e) {
        let message = (e as Error).message;
        if (e instanceof ApiFailure && e.code === 'PROXY_LOCATION_MISMATCH') {
          setMoved((m) => ({ ...m, [id]: true }));
          const d = e.details as
            { expected?: { country?: string }; actual?: { country?: string } } | undefined;
          message = `Its proxy now exits in ${countryName(d?.actual?.country) ?? 'another country'}, but this profile is set to ${countryName(d?.expected?.country) ?? 'its own country'}. Update the location to move it there, or change the proxy.`;
        }
        setActionError((m) => ({ ...m, [id]: message }));
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
    moved,
    updateLocation: (id) =>
      act(id, 'starting', async () => {
        await api('POST', `/profiles/${id}/update-location`);
        await api('POST', `/profiles/${id}/start`);
      }),
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

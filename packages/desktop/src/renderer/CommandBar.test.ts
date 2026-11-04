import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@enclave/shared';
import { filterProfiles, planCommand, type CommandActions } from './CommandBar';

function profile(id: string, name: string, state: 'running' | 'stopped', city: string): Profile {
  return {
    id,
    name,
    createdAt: '2026-11-01T00:00:00Z',
    proxy: {
      type: 'socks5',
      host: 'h',
      port: 1,
      lastCheck: {
        at: '2026-11-04T00:00:00Z',
        ok: true,
        exitIp: `10.0.0.${id}`,
        city,
        country: 'DE',
      },
    },
    fingerprint: { timezone: 'Europe/Berlin', locale: 'de-DE' } as Profile['fingerprint'],
    runtime: {},
    status: { state, containerId: null, streamPort: null, lastError: null, lastStartedAt: null },
  };
}

const ps = [
  profile('1', 'Store Berlin', 'running', 'Berlin'),
  profile('2', 'Store Munich', 'stopped', 'Munich'),
  profile('3', 'Research', 'stopped', 'Hamburg'),
];
const running = (p: Profile) => p.status.state === 'running';
function actions(): CommandActions {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    open: vi.fn(),
    edit: vi.fn(),
    audit: vi.fn(),
    create: vi.fn(),
  };
}

describe('filterProfiles', () => {
  it('filters by name, city and exit IP, but not while a command is typed', () => {
    expect(filterProfiles(ps, 'store').map((p) => p.id)).toEqual(['1', '2']);
    expect(filterProfiles(ps, 'hamburg').map((p) => p.id)).toEqual(['3']);
    expect(filterProfiles(ps, '10.0.0.2').map((p) => p.id)).toEqual(['2']);
    expect(filterProfiles(ps, 'start research')).toHaveLength(3);
  });
});

describe('planCommand', () => {
  it('starts the one profile a name fits', () => {
    const a = actions();
    const plan = planCommand('start research', ps, running, a)!;
    expect(plan.text).toBe('Enter starts Research.');
    plan.run!();
    expect(a.start).toHaveBeenCalledWith('3');
  });

  it('asks for more of a name that fits several, and says why it can not act', () => {
    const a = actions();
    expect(planCommand('start store', ps, running, a)!.text).toMatch(/fits 2 profiles/);
    expect(planCommand('start store berlin', ps, running, a)!.text).toBe(
      'Store Berlin is already running.',
    );
    expect(planCommand('open research', ps, running, a)!.run).toBeUndefined();
    expect(planCommand('stop nobody', ps, running, a)!.text).toMatch(/No profile is called/);
  });

  it('stops every running profile, and leaves plain search alone', () => {
    const a = actions();
    planCommand('stop all', ps, running, a)!.run!();
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(planCommand('store', ps, running, a)).toBeNull();
    expect(planCommand('new', ps, running, a)!.text).toBe('Enter creates a profile.');
  });
});

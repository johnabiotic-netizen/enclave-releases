// The dashboard's bar: type to filter the profiles, or a short command to act on one
// ("start berlin", "stop all"). Everything runs on this PC; nothing is sent anywhere.
// Also the proxy match card on the detail panel.

import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@enclave/shared';
import { countryName } from './format';

export interface CommandActions {
  start(id: string): void;
  stop(id: string): void;
  open(id: string): void;
  edit(id: string): void;
  audit(id: string): void;
  create(): void;
}

interface Plan {
  /** What Enter does, said before it happens; or why it can't. */
  text: string;
  run?: () => void;
  /** Said after it ran. */
  done?: string;
}

const VERBS = ['start', 'stop', 'open', 'edit', 'check', 'new', 'create'] as const;

/** Profiles whose name, exit IP, country or notes contain the text. */
export function filterProfiles(profiles: Profile[], text: string): Profile[] {
  const q = text.trim().toLowerCase();
  if (!q || isCommand(q)) return profiles;
  return profiles.filter((p) => {
    const c = p.proxy.lastCheck;
    return [p.name, c?.exitIp, c?.city, countryName(c?.country), c?.country, p.notes]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

function isCommand(q: string): boolean {
  const verb = q.split(/\s+/)[0]!;
  return (
    (VERBS as readonly string[]).includes(verb) &&
    (verb === 'new' || verb === 'create' || /\s/.test(q))
  );
}

/** The one profile a name refers to: an exact name first, else the only one containing it. */
function pick(profiles: Profile[], name: string): Profile | string {
  const n = name.trim().toLowerCase();
  const exact = profiles.filter((p) => p.name.toLowerCase() === n);
  if (exact.length === 1) return exact[0]!;
  const some = profiles.filter((p) => p.name.toLowerCase().includes(n));
  if (some.length === 1) return some[0]!;
  if (some.length === 0) return `No profile is called "${name.trim()}".`;
  return `"${name.trim()}" fits ${some.length} profiles: ${some
    .slice(0, 3)
    .map((p) => p.name)
    .join(', ')}. Type more of the name.`;
}

export function planCommand(
  text: string,
  profiles: Profile[],
  isRunning: (p: Profile) => boolean,
  act: CommandActions,
): Plan | null {
  const q = text.trim();
  const lower = q.toLowerCase();
  if (!isCommand(lower)) return null;
  const [verb, ...rest] = q.split(/\s+/);
  const arg = rest.join(' ');
  const v = verb!.toLowerCase();
  if (v === 'new' || v === 'create')
    return { text: 'Enter creates a profile.', run: act.create, done: 'Creating a profile.' };
  if (v === 'stop' && arg.toLowerCase() === 'all') {
    const running = profiles.filter(isRunning);
    if (!running.length) return { text: 'No profile is running.' };
    return {
      text: `Enter stops ${running.length === 1 ? running[0]!.name : `all ${running.length} running profiles`}.`,
      run: () => running.forEach((p) => act.stop(p.id)),
      done:
        running.length === 1
          ? `Stopping ${running[0]!.name}.`
          : `Stopping ${running.length} profiles.`,
    };
  }
  const p = pick(profiles, arg);
  if (typeof p === 'string') return { text: p };
  const running = isRunning(p);
  switch (v) {
    case 'start':
      return running
        ? { text: `${p.name} is already running.` }
        : {
            text: `Enter starts ${p.name}.`,
            run: () => act.start(p.id),
            done: `Starting ${p.name}.`,
          };
    case 'stop':
      return running
        ? { text: `Enter stops ${p.name}.`, run: () => act.stop(p.id), done: `Stopping ${p.name}.` }
        : { text: `${p.name} isn't running.` };
    case 'open':
      return running
        ? { text: `Enter opens ${p.name}.`, run: () => act.open(p.id) }
        : { text: `${p.name} isn't running. Type start ${p.name} first.` };
    case 'edit':
      return { text: `Enter edits ${p.name}.`, run: () => act.edit(p.id) };
    case 'check':
      return { text: `Enter checks ${p.name}'s fingerprint.`, run: () => act.audit(p.id) };
  }
  return null;
}

export function CommandBar(props: {
  value: string;
  onChange(text: string): void;
  profiles: Profile[];
  isRunning(p: Profile): boolean;
  actions: CommandActions;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  const plan = planCommand(props.value, props.profiles, props.isRunning, props.actions);

  // Ctrl+K from anywhere on the dashboard.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const hint = plan?.text ?? said;
  return (
    <div className="command">
      <label className="command-bar">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4-4" />
        </svg>
        <span className="visually-hidden">Search profiles or type a command</span>
        <input
          ref={input}
          value={props.value}
          spellCheck={false}
          placeholder="Search, or type a command like start berlin"
          onChange={(e) => {
            setSaid(null);
            props.onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              props.onChange('');
              setSaid(null);
            }
            if (e.key === 'Enter' && plan?.run) {
              plan.run();
              setSaid(plan.done ?? null);
              props.onChange('');
            }
          }}
        />
        <kbd className="mono">Ctrl K</kbd>
      </label>
      {hint ? (
        <p className={`command-hint${plan && !plan.run ? ' warn' : ''}`} role="status">
          {hint}
        </p>
      ) : (
        <p className="command-hint muted">
          Commands: start, stop, open, edit or check followed by a name; stop all; new.
        </p>
      )}
    </div>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/**
 * Whether the profile's fixed time zone and language agree with where its proxy's IP was at
 * the last check (each start checks it, and refuses a start when they don't).
 */
export function ProxyMatch({ profile, moved }: { profile: Profile; moved: boolean }) {
  const check = profile.proxy.lastCheck;
  const fp = profile.fingerprint;
  if (!check?.ok || !check.timezone) {
    return (
      <div className="match">
        <p>Not checked yet. Enclave checks the proxy each time the profile starts.</p>
      </div>
    );
  }
  const region = fp.locale.split('-')[1]?.toUpperCase();
  const place = [check.city, countryName(check.country)].filter(Boolean).join(', ');
  const fits =
    !moved &&
    check.timezone === fp.timezone &&
    (!region || !check.country || region === check.country);
  if (fits) {
    return (
      <div className="match ok">
        <Spark />
        <div>
          <p>
            <strong>Matches its proxy.</strong> Time zone, language and location all point to{' '}
            {place || check.timezone}.
          </p>
          <p className="muted small">Checked {ago(check.at)}.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="match warn">
      <Spark />
      <div>
        <p>
          <strong>Out of step with its proxy.</strong> The proxy&apos;s IP is now in{' '}
          {place || 'another place'} ({check.timezone}), and this profile is set to {fp.timezone}.
          Use Update location on its card, or change the proxy.
        </p>
        <p className="muted small">Checked {ago(check.at)}.</p>
      </div>
    </div>
  );
}

function Spark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="match-icon"
    >
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" />
    </svg>
  );
}

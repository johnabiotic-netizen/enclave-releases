// Screen 4 (ui/screens.md): the profile's browser inside the app. neko's client library draws
// the stream and takes the mouse and keyboard (the phone app uses the same library).

import { useEffect, useRef, useState } from 'react';
import { NekoClient, Overlay } from '@m1k1o/neko';
import type { MediaInUse, Profile, RelayStatus, StreamInfo } from '@enclave/shared';
import { api } from './api';
import { Flag } from './Flag';
import { country, exitIp, SEAM, STATE_WORD, type ShownState } from './format';
import { BackIcon, PhoneIcon } from './icons';

/** What the agent sets as a running profile's lastError while its proxy is down. */
export const PROXY_LOST = 'Proxy unreachable';
const MEDIA_POLL_MS = 2000;

type Link = 'connecting' | 'connected' | 'reconnecting' | 'failed';

interface Props {
  profile: Profile;
  state: ShownState;
  /** The phone app's address while phone access is on (Tailscale), else null. */
  phoneApp: string | null;
  onBack(): void;
  onStart(): void;
  onStop(): void;
}

export function Viewer({ profile, state, phoneApp, onBack, onStart, onStop }: Props) {
  const running = state === 'running';
  const [phoneOpen, setPhoneOpen] = useState(false);
  const proxyLost = running && profile.status.lastError === PROXY_LOST;
  const media = usePhoneNeeded(profile, running);

  return (
    <section className={`viewer ${SEAM[state]}`}>
      <header className="viewer-bar">
        <button className="icon-button" aria-label="Back to profiles" onClick={onBack}>
          <BackIcon />
        </button>
        <span className="dot" aria-hidden="true" />
        <strong className="viewer-name">{profile.name}</strong>
        <span className="muted">{STATE_WORD[state]}</span>
        <span className="viewer-ip">
          <Flag code={country(profile)} /> <span className="mono">{exitIp(profile)}</span>
        </span>
        <span className="spacer" />
        <div className="menu">
          <button
            className="button small"
            onClick={() => setPhoneOpen((o) => !o)}
            aria-expanded={phoneOpen}
          >
            <PhoneIcon /> Open on phone
          </button>
          {phoneOpen && (
            <PhonePanel
              profile={profile}
              running={running}
              phoneApp={phoneApp}
              onClose={() => setPhoneOpen(false)}
            />
          )}
        </div>
        {running && (
          <button className="button small" onClick={onStop}>
            Stop
          </button>
        )}
      </header>
      {proxyLost && (
        <p className="banner error">
          Proxy unreachable, pages will not load. They load again once the proxy is back.
        </p>
      )}
      {running && (media.camera || media.microphone) && (
        <p className="banner">
          This page wants your{' '}
          {media.camera && media.microphone
            ? 'camera and microphone'
            : media.camera
              ? 'camera'
              : 'microphone'}
          . Open {profile.name} on your phone to share it.
        </p>
      )}
      {running ? (
        <Stream key={profile.id} profile={profile} />
      ) : (
        <div className="viewer-off">
          <p>
            {state === 'starting'
              ? `Starting ${profile.name}.`
              : `${profile.name} is ${STATE_WORD[state].toLowerCase()}.`}
          </p>
          {(state === 'stopped' || state === 'error') && (
            <button className="button primary" onClick={onStart}>
              Start profile
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Takes control. While another viewer has it, neko only passes the request on to that
 * viewer, which hands control over (its room.control.request handler); so ask, and ask again
 * until control arrives.
 */
function takeControl(client: NekoClient): void {
  client.request();
  let tries = 0;
  const again = window.setInterval(() => {
    if (client.controlling || !client.connected || ++tries > 10) {
      window.clearInterval(again);
      return;
    }
    client.request();
  }, 300);
}

function Stream({ profile }: { profile: Profile }) {
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [error, setError] = useState<string | null>(null);
  /** Another viewer (the phone) has control; this one only watches until it takes it back. */
  const [watching, setWatching] = useState(false);
  /** This viewer has control and a phone is watching too: it can hand control over. */
  const [canRelease, setCanRelease] = useState(false);
  const clientRef = useRef<NekoClient | null>(null);

  useEffect(() => {
    const area = box.current;
    if (!area) return;
    let disposed = false;
    const off: (() => void)[] = [];
    const client = new NekoClient({ inputMode: 'mouse', autoplay: true });
    clientRef.current = client;

    void (async () => {
      try {
        const stream = await api<StreamInfo>('GET', `/profiles/${profile.id}/stream`);
        if (disposed) return;
        client.setUrl(stream.url);
        await client.login('pc', stream.password);
        if (disposed) return;
        const inner = document.createElement('div');
        inner.style.cssText = 'position:relative;width:100%;height:100%';
        area.replaceChildren(inner);
        off.push(client.transport.attach(inner));
        off.push(new Overlay(client).attach(inner));
        // Control once, when the stream first comes up. Not again after a reconnect: that
        // would take control away from a phone in the middle of its use.
        let asked = false;
        off.push(
          client.store.subscribe(
            (s) => s.connection.status,
            (status) => {
              setLink(status === 'connected' ? 'connected' : asked ? 'reconnecting' : 'connecting');
              if (status === 'connected' && !asked) {
                asked = true;
                takeControl(client);
              }
            },
            { fireImmediately: true },
          ),
        );
        off.push(
          client.store.subscribe(
            (s) =>
              s.connection.status === 'connected' &&
              s.control.host_id !== null &&
              s.control.host_id !== s.session_id,
            setWatching,
            { fireImmediately: true },
          ),
        );
        off.push(
          client.store.subscribe(
            (s) =>
              s.connection.status === 'connected' &&
              s.control.host_id !== null &&
              s.control.host_id === s.session_id &&
              Object.values(s.sessions).some(
                (x) => x.id !== s.session_id && x.profile.name === 'phone' && x.state.is_connected,
              ),
            setCanRelease,
            { fireImmediately: true },
          ),
        );
        // The phone asks for control (its pointer button, or a tap): hand it over. Both screens
        // are the same person's, so whichever is used gets control.
        off.push(
          client.events.on('room.control.request', () => {
            if (client.controlling) client.release();
          }),
        );
        // Text copied in the profile goes to the PC's clipboard at once, so the PC's clipboard
        // always holds whichever side copied last. A paste (Ctrl+V) then always means the PC's
        // clipboard; the library's guess between the two is not needed here.
        off.push(
          client.events.on('room.clipboard.updated', (text: string) => {
            void window.enclave.copyText(text);
          }),
        );
        client.preparePaste = async (text) => {
          if (!text || text === client.state.control.clipboard?.text) return;
          client.send('clipboard/set', { text });
          await new Promise<void>((done) => {
            const stop = client.events.on('room.clipboard.updated', () => (stop(), done()));
            setTimeout(() => (stop(), done()), 500);
          });
        };
        // Whoever uses the mouse here takes control back from the phone.
        const take = () => {
          if (!client.controlling) takeControl(client);
        };
        inner.addEventListener('mousedown', take, true);
        off.push(() => inner.removeEventListener('mousedown', take, true));
        client.connect();
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setLink('failed');
        }
      }
    })();

    return () => {
      disposed = true;
      for (const f of off.splice(0)) f();
      client.release();
      client.disconnect();
      clientRef.current = null;
      area.replaceChildren();
    };
  }, [profile.id]);

  return (
    <div className="stream-area">
      {watching && (
        <p className="banner control-banner">
          Your phone has control of {profile.name}. Clicking in the browser takes it back.
          <button
            className="button small"
            onClick={() => clientRef.current && takeControl(clientRef.current)}
          >
            Take control
          </button>
        </p>
      )}
      {canRelease && (
        <button
          className="button small control-release"
          onClick={() => clientRef.current?.release()}
          title="Lets your phone use the profile without asking"
        >
          Give control to phone
        </button>
      )}
      <div className="stream" ref={box} />
      {link !== 'connected' && (
        <p className="stream-status">
          {link === 'failed'
            ? (error ?? 'Could not connect to the profile.')
            : link === 'reconnecting'
              ? 'Connection lost. Reconnecting.'
              : 'Connecting.'}
        </p>
      )}
    </div>
  );
}

/** What a page in the profile is asking for that no phone is sharing yet. */
interface PhoneNeeded {
  camera: boolean;
  microphone: boolean;
}
const NOTHING_NEEDED: PhoneNeeded = { camera: false, microphone: false };

/** Polls the profile's camera and mic use, for the "switch to your phone" notice. */
function usePhoneNeeded(profile: Profile, running: boolean): PhoneNeeded {
  const [needed, setNeeded] = useState<PhoneNeeded>(NOTHING_NEEDED);
  const notified = useRef(false);
  useEffect(() => {
    if (!running) {
      setNeeded(NOTHING_NEEDED);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const now = await api<MediaInUse>('GET', `/profiles/${profile.id}/media`);
        if (!alive) return;
        const next = {
          camera: now.camera && !now.phoneCamera,
          microphone: now.microphone && !now.phoneMicrophone,
        };
        setNeeded((old) =>
          old.camera === next.camera && old.microphone === next.microphone ? old : next,
        );
        const wants = next.camera || next.microphone;
        // One Windows notification each time a page starts asking, in case the app is behind
        // other windows.
        if (wants && !notified.current) {
          notified.current = true;
          new Notification(`${profile.name} wants your ${next.camera ? 'camera' : 'microphone'}`, {
            body: 'Open the profile on your phone to share it.',
            silent: true,
          });
        }
        if (!wants) notified.current = false;
      } catch {
        // The next poll follows in a moment.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), MEDIA_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [profile.id, profile.name, running]);
  return needed;
}

function PhonePanel(props: {
  profile: Profile;
  running: boolean;
  phoneApp: string | null;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Through the relay, the phone app is at the relay's address (paired phones only).
  const [relay, setRelay] = useState<RelayStatus | null>(null);
  // Whether this run can open on a phone: not when it started before phone access was on.
  const [phoneReady, setPhoneReady] = useState(true);
  useEffect(() => {
    void api<RelayStatus>('GET', '/relay').then(setRelay, () => {});
  }, []);
  useEffect(() => {
    if (!props.running) return;
    void api<StreamInfo>('GET', `/profiles/${props.profile.id}/stream`).then(
      (s) => setPhoneReady(s.phone),
      () => {},
    );
  }, [props.running, props.profile.id]);
  const viaRelay = relay?.enabled && relay.signedIn ? relay : null;
  const address = viaRelay?.url ?? props.phoneApp;
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [props]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="popover phone-panel" ref={ref}>
      {address ? (
        <>
          <p>
            Open the Enclave app on your phone and choose <strong>{props.profile.name}</strong>. It
            shows the same browser, with the same tabs and the same IP.
          </p>
          {!phoneReady && (
            <p className="notice error">
              {props.profile.name} was started before phone access was on, so your phone can&apos;t
              open it yet. Stop it and start it again.
            </p>
          )}
          <p className="mono small">{address}</p>
          <button
            className="button small"
            onClick={() => void navigator.clipboard.writeText(address).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
          {viaRelay && viaRelay.devices.length === 0 && (
            <p className="muted small">No phone is paired yet. Pair one in Settings.</p>
          )}
        </>
      ) : (
        <p>
          {relay?.enabled
            ? 'Sign in to your relay in Settings, then pair your phone.'
            : 'Phone access is off on this PC. Turn it on in Settings.'}
        </p>
      )}
    </div>
  );
}

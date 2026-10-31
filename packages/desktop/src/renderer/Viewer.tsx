// Screen 4 (ui/screens.md): the profile's browser inside the app. neko's client library draws
// the stream and takes the mouse and keyboard (the phone app uses the same library).

import { useEffect, useRef, useState } from 'react';
import { NekoClient, Overlay } from '@m1k1o/neko';
import type { MediaInUse, Profile, StreamInfo } from '@enclave/shared';
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
            <PhonePanel profile={profile} phoneApp={phoneApp} onClose={() => setPhoneOpen(false)} />
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

function Stream({ profile }: { profile: Profile }) {
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const area = box.current;
    if (!area) return;
    let disposed = false;
    const off: (() => void)[] = [];
    const client = new NekoClient({ inputMode: 'mouse', autoplay: true });

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
        let asked = false;
        off.push(
          client.store.subscribe(
            (s) => s.connection.status,
            (status) => {
              setLink(status === 'connected' ? 'connected' : asked ? 'reconnecting' : 'connecting');
              if (status === 'connected') {
                asked = true;
                client.request();
              }
            },
            { fireImmediately: true },
          ),
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
          if (!client.controlling) client.request();
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
      area.replaceChildren();
    };
  }, [profile.id]);

  return (
    <div className="stream-area">
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

function PhonePanel(props: { profile: Profile; phoneApp: string | null; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
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
      {props.phoneApp ? (
        <>
          <p>
            Open the Enclave app on your phone and choose <strong>{props.profile.name}</strong>. It
            shows the same browser, with the same tabs and the same IP.
          </p>
          <p className="mono small">{props.phoneApp}</p>
          <button
            className="button small"
            onClick={() =>
              void navigator.clipboard.writeText(props.phoneApp!).then(() => setCopied(true))
            }
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <p className="muted small">Pairing with a QR code comes with phone linking.</p>
        </>
      ) : (
        <p>Phone access is off on this PC. Turn it on in Settings.</p>
      )}
    </div>
  );
}

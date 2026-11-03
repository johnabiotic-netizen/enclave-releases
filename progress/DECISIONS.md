# Decision log

One entry per real decision. Newest at the top. Keep each to a few lines: context, decision, reason. Record here whenever you deviate from a spec because reality differed, or when you make a choice the docs left open.

## 2026-11-03  Stage 7: Docker Desktop leaves the tester guide
Context: The easier install (DECISIONS 2026-11-01) had run Docker and a test container in Enclave's own WSL system, but not a real profile, and not on a PC without Docker. A tester's PC without Docker (Oladoyinbo) set up 0.3.4 from Setup alone and ran a profile (the owner has their screenshot).
Decision: docs/setup/beta-tester.md, the guide page and the landing page no longer ask for Docker Desktop: install Enclave, then Setup (Turn on WSL, Set up, Download the browser). A PC that already has Docker Desktop or Docker in WSL keeps using it (Setup's order is unchanged).
Reason: The hardest setup step is gone for testers; Setup already handles both cases.

## 2026-11-02  Stage 7: proxy report in the create wizard, and a proxy tester screen
Context: The owner asked for a report on a proxy when it is entered for a new profile, and for the proxy tester (until now CLI only) in the app, for many proxies and port ranges.
Decision: One rating for both (`rateProxy`, packages/shared/src/proxy-test.ts): not usable only when the safety check fails; a warning for an IP-database listing as proxy or data centre, an answer slower than 1.5 s, an IP that changed between checks, or a Pixelscan verdict other than consistent; otherwise good. The wizard's Check proxy adds the exit IP's reputation (ip-api.com, IP only; not for the test proxy) and offers a Deep check (Pixelscan in a temporary profile, through `/proxy-tests`). The Proxies screen takes one proxy per line, a port may be a range (`expandProxyLines`, up to 1000), names a line that isn't a proxy before sending (the parser moved to shared as `parseProxySpec`), shows rows as they are checked, and opens Create profile with a row's proxy. The sticky check is optional there (5 minutes) and left out of the wizard.
Reason: IP databases don't predict detection sites well (seen with this provider's ports in Stage 3), so a listing warns but doesn't block, and Pixelscan stays one click away rather than a minute on every profile.
Before selling: ip-api.com's free tier is for non-commercial use and plain HTTP only; switch to a paid HTTPS lookup (or make the lookup optional) before paid plans. A deep check's temporary profile shows in the profile list for its minute or two.

## 2026-11-01  Stage 7: export and import a profile as one encrypted file
Context: Stage 7 task "Export/import a single profile as an encrypted file". A profile's fingerprint names the graphics card it was made on, and the agent refuses to start it on another (hard rule 2), so a file can't make a profile run on any PC.
Decision: specs/profile-file.md. Passphrase (10+ characters) through scrypt (N 2^17, r 8, p 1); AES-256-GCM in 1 MiB records with the header and a final flag authenticated; gzip inside. Holds profile.json, the proxy password and the /data volume without caches and lock files, read and written through a created, never started container. Export needs the profile stopped. Import makes a new id, refuses a profile this PC already has (same fingerprint), and on another graphics card imports but says the profile can't start there. App only (IPC with Windows' file dialogs), not in the HTTP API, which a Tailscale phone can reach.
Reason: A backup and a move to an identical PC without weakening the fixed fingerprint; no outside service or key to keep. Cloud backups (R2) stay for after the beta.

## 2026-11-01  Stage 7 easier install: Enclave's own WSL system with Docker Engine
Context: Stage 7 "Easier install". Docker Desktop is the hardest setup step, doesn't run on older Windows builds (the owner's 21H2), and is paid for larger companies. Verified 2026-11-01 on this PC (WSL 2.7.14, kernel 6.18.33): every WSL 2 distro shares one network namespace (a test distro saw Ubuntu's docker0, same netns inode), so two Docker engines in WSL at once would fight over docker0 and the firewall chains. A fresh distro gets /dev/dxg and /usr/lib/wsl (the GPU). WSL refuses sparse disks by default ("potential data corruption"), so that is not used.
Decision: images/wsl: Debian 13 slim (pinned digest) with Docker Engine 29.9.2's static build (sha256 pinned; no docker CLI or ctr), iptables, ca-certificates and socat at pinned versions; wsl.conf starts dockerd at boot, root by default, no Windows drives, no interop. Built by enclave-camoufox workflow "Enclave WSL" (scripts/sync-wsl-ci.sh), fetched with scripts/fetch-wsl-system.sh into packages/desktop/wsl/ and shipped in the installer (89 MB; 332 MB once imported); the app checks its sha256. Setup uses, in order: Docker Desktop, a Docker Engine already in a WSL distro, Enclave's system (distro "Enclave" in %LOCALAPPDATA%Enclavewsl, set up by a Set up button); a Turn on WSL button runs `wsl --install --no-distribution --web-download` elevated. The agent's WSL bridge runs `docker system dial-stdio` where the docker tool exists, else socat to the socket. Uninstalling Enclave leaves the distro (it holds the profiles' browser data, and electron-builder runs the old uninstaller on every update).
Reason: One click instead of a Docker Desktop install, on more Windows versions, with no Docker licensing; never installed next to another Docker because of the shared network.

Format:
```
## 2026-10-31  Stage 5 verify first: Electron 45, async safeStorage, viewer with neko's client library
Context: Stage 5 "Verify first". Checked npm, releases.electronjs.org and the Electron safeStorage docs on 2026-10-31.
Decision: Electron 45.2.1 (Node 24.22.1, Chromium 156; the newest stable, three majors supported), React 19.3.1, Vite 8.3.5, @vitejs/plugin-react 6.1.2, electron-builder 26.18.0, @playwright/test 1.64.1; TypeScript stays at the repo's 6.0.3. Secrets use the async safeStorage API (isAsyncEncryptionAvailable, encryptStringAsync, decryptStringAsync): the sync calls are deprecated in 45 and removed in 46. On Windows it is DPAPI, which protects from other Windows users, not from other programs of the same user. The PC viewer uses @m1k1o/neko 3.2.0 (neko's official client library, as the phone app) directly in the renderer with mouse and keyboard input, not a webview or iframe of neko's page.
Reason: Node 24 in Electron matches the agent, so the agent runs in the main process unchanged (startAgent). One client library for PC and phone; no second web app to keep in step.

## 2026-11-01  Stage 7 starts with a free beta; browser source public, image on GitHub's registry
Context: Stage 7 is about selling. The owner wants to test with a few people first (no payments yet). Testers need the browser image on their own PCs, which until now could only be built on the owner's PC. Giving testers the browser distributes Camoufox (MPL 2.0), whose modified files must then be public; enclave-camoufox is private.
Decision: (1) No billing, signing or payment provider for now; testers click past SmartScreen ("More info, Run anyway"). (2) Owner chose a separate public repository, github.com/johnabiotic-netizen/enclave-browser-source: the two browser patches (MPL), the neko patch (Apache), their builds, the base versions (Camoufox v158.0-beta.40, upstream c9ed439; neko v3.2.0) and a pointer to Debian's sources; everything else stays private. (3) Owner chose GitHub's registry for the image (ghcr.io/johnabiotic-netizen/enclave-browser, public), pushed with the owner's own token (Docker login done by the owner); the app pins it by digest and downloads it from Setup with progress. (4) The relay takes single-use invites (one per tester, made over SSH, only hashes kept, admin reachable from inside the container only); the owner's shared code was switched off. (5) docs/setup/beta-tester.md is the testers' guide. No telemetry: testers report by hand.
Reason: A beta needs a stranger's PC to work without the owner at the keyboard; the rest of Stage 7 (payments, signing, legal review) follows what the beta shows.

## 2026-11-01  Downloads leave a profile on request, to the phone or the PC
Context: Owner asked where downloads go. The profile's browser saves to /data/downloads in its Docker volume, which neither the phone nor a normal Windows user could reach.
Decision: The agent lists a running profile's finished downloads (GET /profiles/:id/downloads, no .part files) and gives one by exact name from that list (docker cp, up to 500 MB). The phone app offers each new download ("Downloaded <file>", Save to phone) and has a Downloads list; through the relay a large response goes in 256 KB pieces with at most 8 unacknowledged (RESPONSE_START/DATA/END/ACK). The Windows app lists them in a running profile's details: Save to PC writes into the Windows Downloads folder with the Zone.Identifier mark (ZoneId=3, "from the internet"), and Show in folder; Enclave never opens a downloaded file. Files are passed on unchanged.
Reason: Files come from websites; the user decides what to take out of the profile, and Windows' own warnings apply when it is opened. Verified: the owner's tinified.zip (538,007 bytes) through the agent matches the profile's copy (SHA-256); a name outside the list is refused; tunnel pieces and window covered by a test.

## 2026-11-01  Phone camera through the relay: a clean picture over full frame rate (owner)
Context: Through the New Jersey relay (Nigeria to New Jersey and back) the owner saw smears in the phone camera. neko 3.2.0 hands the camera's packets straight to the decoder and asks for a keyframe only every 3 s, so a lost packet smeared the picture for up to 3 s. Measured in Phone test, 60 s each, with the owner sharing: the original gave 29 frames a second in bursts (13 to 56) with smears; a 100 ms jitter buffer dropped late packets and froze the camera (1 to 19 a second: packets on this route come late in bursts more than they are lost); dropping frames after a loss until a keyframe gave a clean picture at about 11 a second; decoding every frame and asking for a keyframe at once gave 30 a second, steadier, with short smears.
Decision: The owner compared them on the phone and chose the clean picture. enclave-camoufox c0dddd3 (neko/enclave-webcam-fifo.patch): rtpvp8depay wait-for-keyframe=true for the phone camera, and neko asks for a keyframe as soon as a video packet is missing for 120 ms (at most every 500 ms), besides the 3 s timer. Built by GitHub Actions run 41331554934; neko sha256 e88f09eb..., pinned in images/browser/Dockerfile.
Reason: A clean picture is easier to watch on a call. The frame rate follows the round trip to the relay (how fast a keyframe comes after a loss), so a closer relay (London, about 130 ms) would make it smoother; noted for later.

## 2026-11-01  Phone camera on real websites: the content sandbox may read the camera file
Context: The owner tested webcamtests.com from the phone: the profile's camera opened (HD Webcam, 1280x720) but every frame was black. The phone's frames were reaching the profile (25 a second). Our camera reads them in the page's own content process; a website's content process is sandboxed and couldn't open /dev/shm/enclave-camera, so the camera never got a frame. Local test pages (file://) run in a content process that may read files, which is why every earlier test (Stage 4 included) passed. So the phone camera had never worked on a real website.
Decision: Firefox's security.sandbox.content.read_path_whitelist opens exactly that one file to content processes, read only (RUNTIME_PREFS in launch_browser.py, not part of the fingerprint). Verified on webcamtests.com in Phone test: the phone's picture shows, a tab process maps the file. scripts/phone/pages/camera-variants.html checks 15 ways sites open a camera. Also found: the nonstandard getUserMedia option fake: true gives Firefox's built-in test camera; to check against Windows Firefox later.
Reason: The smallest opening that makes the camera work; the file holds only the phone's latest frame, readable by the browser's user anyway. Lesson: camera and file tests run against a real https site from now on, not only local pages.

## 2026-11-01  Stage 6: each paired phone opens all profiles or only chosen ones
Context: Owner asked to share only some profiles with a phone.
Decision: The PC keeps, per paired phone, "all" or a list of profile ids. Pairing asks first ("Which profiles can this phone open?", default Only these profiles, nothing ticked); Settings shows each phone's profiles with Change. The PC's session filters the profile list and answers any other profile as not found (agent API), 401 (its stream server) or close 4403 (its WebSocket), without asking the agent; a change applies at once and closes that phone's open streams of profiles taken away, and the phone app goes back to its list saying why. Phones paired before keep all profiles. Tailscale mode has one shared token and can't do this.
Reason: Enforced on the PC, not the relay, so nothing outside the owner's PC can widen it. Verified: 3 unit tests (list, start/stop/stream/media/files, stream server and socket refused, the agent never asked about the other profile; a change applies at once) and live with a local relay: a phone allowed one of two profiles saw only it; taking it away while open closed it on the phone within 3 s.

## 2026-11-01  Stage 6: the streaming program may send UDP; the browser still reaches only its proxy
Context: Media between the phone and the profile needs the profile's streaming program (neko) to reach the TURN server and, for a direct path, the phone. Inside the container neko and the browser both ran as user neko, so an egress rule by user would have opened the same paths to the browser (a page could learn the real IP through STUN).
Decision: neko now runs with its own primary group, `stream` (run-neko.sh, through setpriv; supplementary groups unchanged, no capabilities). In relay mode the egress lock adds two rules for that group only: UDP to anywhere (WebRTC media, direct where the networks allow) and TCP to the TURN server's port. The browser (group neko) and root stay locked to the proxy. Verified in a running profile: as neko:neko and root, UDP and TCP to the TURN server and the internet are refused; as neko:stream, UDP and TURN TCP go out; the browser process can't attach to neko (ptrace scope 1, no new privileges). Tailscale and off modes add no rules.
Reason: Hard rule 1 is about the profile's traffic, which is the browser's. The stream to the user's own phone isn't browsing traffic, and only neko, which no website can drive, gets the exception.

## 2026-11-01  Stage 6: how phone linking was built (differences from relay-protocol.md's first plan)
Context: Building packages/relay, the agent's link and the phone app's relay mode.
Decision: (1) Everything between phone and PC goes through an end-to-end encrypted tunnel (ECDH P-256 static plus ephemeral, HKDF, AES-256-GCM with counters; Web Crypto only, shared by Node and the phone). The relay sees only who talks to whom and how much. (2) The phone isn't logged in to the account: the QR code carries a one-time code for the relay plus a secret and a PC key hash the relay never sees, so neither side can be given a swapped key. (3) Sessions are per phone and PC; the profile list travels inside the tunnel instead of a relay-held snapshot, and each profile's stream password still applies. (4) Through the tunnel the PC answers only the phone app's agent calls and running profiles' stream servers. (5) The relay keeps accounts, PCs and devices in one JSON file (tiny data; node:sqlite still prints an experimental warning on Node 24) and hashes passwords with Node's built-in argon2id (no native module). (6) The relay serves the phone app, which detects relay mode by `/r/v1/info`; Tailscale mode stays as it was. (7) No TURN over TLS yet: coturn can't read Caddy's certificates without running as root; TURN over TCP 3478 covers networks that block UDP. (8) The relay image bundles the relay with esbuild (no node_modules), on node:24.22.2-trixie-slim; Caddy 2.11.7 and coturn 4.18.0, all pinned by digest.
Reason: The spec's goal (the relay never sees browsing data) is met by construction rather than by policy, at the cost of a little code on both ends. Verified locally with a simulated phone (Edge) through a local relay and coturn: pairing, start from the phone, stream direct, through TURN UDP and TURN TCP, phone camera and mic, revoke during a stream (closed within 2 s, PC side too), and a capture of the relay's sockets showing no profile name, id, password, API path or signaling.

## 2026-11-01  Stage 6: relay and TURN on a small VPS, under the owner's own domain
Context: Stage 6 verify first. The relay needs a fixed address, HTTPS for the phone app (camera needs a secure page) and UDP for TURN. coturn 4.18.0 is current and supports time-limited credentials (use-auth-secret, HMAC of a timestamped user name). neko uses backend ICE servers only without ICE lite, so TURN means turning ICE lite off and giving neko TURN servers per start. Fly.io carries UDP only with a dedicated IPv4 and bills traffic per GB.
Decision: Owner chose a small VPS (about 4 to 6 euros a month, traffic included) running the relay and coturn in Docker, and their own domain (about 10 dollars a year). The owner creates the server and the domain; Claude gets SSH access with a key made on the PC (~/.ssh/enclave_relay, never in the repo). Media goes direct where networks allow and through TURN otherwise, DTLS-SRTP end to end. A profile's egress lock gains one exception: neko (the streaming program) may reach the TURN server; the browser still reaches only its proxy.
Reason: Cheapest dependable setup with full UDP; a real domain is needed for selling anyway.

## 2026-11-01  Stage 5 closed; acceptance test 1 moves to Stage 7
Context: Test 1 needs a fresh Windows PC and a browser image that can be set up there; our Camoufox build has no public download until Stage 7 publishes the image.
Decision: Owner agreed to close Stage 5 with test 1 carried to Stage 7. The owner reviews the look and wording (test 5) while using the app; flagged items are fixed as they come.
Reason: Everything else in Stage 5 is built and verified on the owner's PC.

## 2026-11-01  Update location changes the location keys only, voices included
Context: specs/profile-schema.md allows timezone, locale, languages and geolocation to change via "Update location". In the saved Camoufox config the language also decides the Windows speech voices (Camoufox draws voices for the locale; a German Windows has German voices), and Firefox's intl.locale.requested.
Decision: Update location makes a fingerprint for the new place on the profile's own GPU and copies only timezone, locale:language/region/script, geolocation:*, webrtc:ipv4, voices, voices:blockIfNotDefined and the pref intl.locale.requested; the summary fields follow. Offered in the edit form (PATCH updateLocation) and after a refused start (POST /profiles/:id/update-location). Logged as location-updated.
Reason: Voices that do not match the language would be an inconsistency a site can see; everything else (screen, fonts, hardware, WebGL, audio, devices) stays, as hard rule 2 requires.

## 2026-11-01  The app's data folder is fixed at %APPDATA%Enclave (it holds the encryption key)
Context: Setting productName "Enclave" for the installer moved Electron's userData folder from %APPDATA%@enclavedesktop to %APPDATA%Enclave. safeStorage encrypts with an AES key kept (DPAPI-wrapped) in that folder's "Local State", so the app started with a new key and could not decrypt the agent token or any profile's sealed passwords ("Error while decrypting the ciphertext"). Nothing had been encrypted with the new key.
Decision: main.ts sets userData to %APPDATA%Enclave before anything else, whatever the app is called. On the owner's PC the original Local State was copied there (both versions backed up first). Verified: the token decrypts, Phone test starts, Profile 2's real proxy password works.
Reason: The key file must never move again; a lost key means every saved password is lost. For Stage 7: back up or export this key with the user's data, and keep the folder fixed across versions.

## 2026-11-01  The setup screen no longer loops when the service cannot start
Context: After the PC restarted (04:11) WSL hung, the service failed, and the app went to 100% CPU: Setup ran a check on mount, the check restarted the service, "starting" unmounted Setup, the next failure mounted it again.
Decision: Once the service has failed, Setup stays mounted through restarts; the main process runs one restart at a time. Verified: with the service failing, the app sat on Setup at about 0% CPU.
Reason: A check must never be able to start itself again.

## 2026-10-31  Setup checker in the app; the browser image download waits for Stage 7
Context: Stage 5 asks for a first-run image build with a progress UI. Enclave's browser image needs our own Camoufox build, which has no public download yet, so a fresh PC cannot build it from the app; only the owner's PC (with the local cache) can.
Decision: The setup checker (main process) checks virtualization (hypervisor present or firmware flag), WSL 2, Docker installed (Docker Desktop, or dockerd in the configured WSL distro), Docker reachable, and the image; each failure lists the exact fix (docs/setup/windows-setup.md) with Recheck, which also restarts Enclave's service. If the service cannot start, the app opens on Setup. The image row explains how the browser is set up on this build. Stage 7 publishes the image to a registry and adds the one-time download with a progress bar.
Reason: A build button that can only fail on a customer PC would mislead; the download belongs with publishing the image.

## 2026-10-31  Settings: data folder shown, not movable yet; settings restart the service
Context: ui/screens.md lists data location among the settings. Moving the folder means moving every profile's files and encrypted secrets while profiles may run; browser data lives in Docker volumes anyway.
Decision: Settings shows the data folder with Open folder; moving it is left for later. Idle default (ENCLAVE_IDLE_MINUTES) and phone access live in app-settings.json; changing them restarts the agent inside the app (running profiles keep running; phone mode applies to profiles started afterwards). The default proxy is kept encrypted with safeStorage and prefills Create profile. GET /system reports each running profile's memory (docker stats, less page cache).
Reason: A half-working move would risk the user's profiles; showing where the data is answers the common need.

## 2026-10-31  Windows app viewer: app:// origin, Windows clipboard wins, phone sharing in /media
Context: The viewer is the neko client library in the app window. neko refused its WebSocket (the window came from file://, which has no origin). The library guesses which clipboard is newer on Ctrl+V and guessed wrong inside the app. The "switch to your phone" notice needs to know whether a phone already shares.
Decision: The window loads from a privileged app://enclave scheme (only files of the built renderer are served); every profile's neko gets a CORS list with its own page, app://enclave and, in phone mode, the phone app (before, without phone mode, neko had no list and accepted any origin). Each profile copy goes straight to the Windows clipboard through the main process, so the Windows clipboard always holds the latest copy of either side and Ctrl+V always pastes it. GET /profiles/:id/media also says phoneCamera (frames under 3 s old) and phoneMicrophone (a phone stream into audio_input); the notice shows only what no phone shares. The window may use only notifications and the clipboard (permission handler).
Reason: A real origin is what Electron recommends over file:// and lets neko check it. The copy rule makes paste predictable on the PC. Profiles started before this change need a restart to accept the app.

## 2026-10-31  Create wizard: device step is Auto only; proxy checked before creating
Context: ui/screens.md has a device template step ("pick a Windows device class, or Auto"). In Enclave the device is bound to the real PC: the profile renders on this PC's GPU (the fingerprint names it) and the screen size comes from real Windows screen-size frequencies.
Decision: The Device step shows one choice, Auto, and says what it means. The wizard checks the proxy with a new call, POST /proxy-check (same safety check as a start, nothing saved), before Continue; Create checks it again. The edit form changes name, notes, idle stop and proxy (same country and time zone only; a mismatch is explained). "Update location" is its own task (D2).
Reason: Other device classes would claim a GPU the profile does not render on, which is detectable. Checking before Create means the user sees the exit IP and location before a fingerprint is made for them.

## 2026-10-31  Profile passwords sealed per profile with safeStorage, not the Windows credential manager
Context: Stage 5 moves secrets off plain files. Options: Windows Credential Manager (keytar-style native module) or Electron safeStorage. keytar is archived and needs a native build; safeStorage is built into Electron and uses DPAPI.
Decision: Each profile's secrets stay one small file, now `secrets.sealed` encrypted with safeStorage (async API); the agent takes a SecretSealer, so the agent code stays free of Electron. The app seals plain files at start after checking that encryption reads back. New error code `SECRETS_LOCKED` when an agent without a sealer meets a sealed profile.
Reason: No native module to build or ship; secrets stay next to the profile they belong to, so delete and backup stay simple.

## 2026-10-31  Closing the window keeps profiles running in the tray
Context: Stage 5 acceptance 4 leaves it to us: stop profiles on close, or keep them running. The phone can reach a profile only while the agent (inside the app) runs.
Decision: Owner chose: closing the window hides Enclave to the system tray and profiles keep running. "Quit Enclave" in the tray menu stops every profile cleanly (tabs and logins kept) and exits.
Reason: A phone session should not end because the PC window was closed.

## 2026-10-31  Stage 4 test 7: "switch to your phone" notice, shown by the Windows app (Stage 5)
Context: Acceptance test 7 asks that a page requesting the camera with no phone connected gets a clear message and nothing crashes. With no phone connected, nobody is looking at the phone, so the message has to appear on the PC. The PC viewer today is neko's web page; the Windows app (Stage 5) replaces it.
Decision: Stage 4 delivers the safe behaviour (black camera, silence, no crash; verified) and the data: `GET /profiles/:id/media` says when a page wants the camera or mic and whether a phone is sharing. Owner (2026-10-31): the message is a "switch to your phone" notice. Stage 5: when a page wants the camera or mic and no phone is sharing, the Windows app shows a Windows notification and a banner on that profile ("This page wants your camera. Open <profile> on your phone to share it."). A connected phone already shows "This page wants your camera and microphone." with Share. Stage 6: a push notification to the phone when its app is closed, opening that profile; push goes through Google or Apple, so it carries only the profile name, never the page; owner to approve before it is turned on. Stage 4 closed on this basis.
Reason: Building the message into neko's page would be thrown away in Stage 5.

## 2026-10-31  Browser camera keeps the last frame when a read catches it mid-write
Context: The owner still saw single black flashes in the camera picture (only the camera, 19:09:12 and 19:09:27). A monitor in the container showed fresh, non-black frames reaching shared memory at about 30 per second at those exact times, with the phone's connection up. The browser's reader (enclave-camoufox zz-enclave-phone-media.patch) drew a black frame whenever its copy overlapped camfeed writing the next frame (sequence odd, or changed during the copy). A write usually takes 0.2 ms but measured up to 45 ms on the busy PC.
Decision: The reader retries up to 4 times, 1 ms apart. If the frame is still mid-write it keeps the previous frame. It goes black only when there is no fresh frame (phone not sharing, or the last frame is over 2 s old). It also adds the acquire fence after the copy that the seqlock check needs. Built as enclave-camoufox commit 6edef23 (run 41228590512, zip 16556f40). Verified with a stand-in writer that holds every write for 4 ms at 50 frames per second: the old browser showed 269 of 1143 frames black, the new one 0 of 1153; with the writer stopped, all frames are black as before.
Reason: A real webcam never shows a black frame between two good ones. Keeping the last frame is what the hold in camfeed already does for network gaps.

## 2026-10-31  Screen encoder: one VP8 thread at the fastest speed
Context: The owner felt slowness on the real phone. neko's default screen pipeline (VP8, threads=4, cpu-used=4) took about 250% CPU on the owner's i5-7300U (2 cores, 4 threads; load 9 to 11) and still delivered only 11 to 13 fps at the viewer, with 70 to 125 ms jitter. Per-thread profiling showed the 4 encoder threads using most of it; changing cpu-used or quality limits alone barely moved it (libvpx VP8 worker threads spin while waiting).
Decision: Ship /etc/neko/neko.yaml with neko's default pipeline except threads=1 and cpu-used=16 (same bitrate, same quantizer limits, same keyframe distance, 25 fps, 1920x1080).
Reason: Measured with a simulated phone watching the same page: about 80% CPU, 25 to 26 fps received, jitter 10 to 17 ms. threads=1 with cpu-used=4 reached only 22 to 23 fps at 118%; cpu-used=8 23 to 24 fps at 101%. The freed CPU also leaves room for the phone camera's decode and the browser.

## 2026-10-31  A short gap in the phone camera holds the last frame instead of going black
Context: On the real phone the owner still saw one blackout in a few minutes; measured, the phone's frames paused 2.8 s once (network). The browser shows black when the last frame is over 2 s old, so any hiccup over 2 s blacked out the camera, which no real webcam does.
Decision: camfeed.py, while neko still has the pipe open (the phone is sharing), republishes the last frame every 0.5 s when no new one arrives, for up to 10 s. When the phone stops sharing (pipe closed) nothing is republished and the camera goes black after 2 s as before. No browser rebuild.
Reason: Freezing briefly is how a real webcam behaves on a hiccup. Verified with a simulated phone whose camera stalls 3 s in every 10: longest gap without a frame went from 3.07 s to 0.55 s; after sharing stops, frames stop.

## 2026-10-31  The phone frames its camera as a 16:9 webcam before sending
Context: The profile's camera is a 1280x720 landscape webcam and neko scales whatever arrives to that size, ignoring shape. A phone held upright films portrait, so the owner saw faces squashed on the real phone.
Decision: The phone app sends the middle 16:9 of its camera picture, drawn at 1280x720 frame by frame (canvas fed by requestVideoFrameCallback) from the on-screen preview, which plays the camera itself cut to the same 16:9 by CSS (a hidden player gave the owner a blackout every 3 to 5 s on the real phone: the phone can pause players it considers hidden, and the profile shows black after 2 s without frames; a watchdog restarts the preview if it stops), and asks the camera for 4:3 at 1440x1080: phone sensors are 4:3, so a 16:9 request would make the phone cut the sensor first and an upright phone would look zoomed in (owner, real phone); 4:3 keeps the full sensor width and the crop stays sharp (1080x608 from 1080x1440). The camera stays unmirrored, like a real webcam; sites mirror their own self-view. The preview shows exactly what is sent. Landscape pictures fill the frame whole.
Reason: Fixing it on the phone needs no neko rebuild, works on Android and iPhone, and a centered 16:9 crop is how a laptop webcam frames a person; black side bars would look like no real webcam.

## 2026-10-31  Location is removed from phone photos and videos before they reach a profile
Context: Phones often save where a photo or video was taken (GPS in Exif or XMP, ©xyz or QuickTime location in MP4/MOV). Uploaded through a profile whose proxy is in another country, that gives away the owner's real location and contradicts the proxy (hard rules 1 and 3). The owner chose stripping by default.
Decision: The agent strips location from every file the phone sends (POST /profiles/:id/files) before it enters the container, in place: GPS tags leave every Exif block (JPEG incl. multi-picture, PNG eXIf, WebP, HEIC/AVIF), GPS fields in XMP become spaces, MP4/MOV location boxes become 'free' boxes. Size, picture and all other metadata (camera, date, orientation) stay byte for byte. Only those image and video formats are touched; other files (documents, archives) pass unchanged so their checksums never break. No option to turn it off yet.
Reason: A photo without location is normal (screenshots, iPhone uploads, most sites strip it anyway); one with a location that contradicts the proxy is a leak. Removing only the location keeps the file looking like it came straight from a phone; no re-encode means no quality loss.

## 2026-10-31  Phone files go into the profile's open file picker through the agent
Context: Stage 4 asks to hand a phone file (or a photo taken now) to the profile's file picker. neko 3.2 can take over Firefox's file picker (desktop.file_chooser_dialog), but its built-in PC client can't answer it, so PC users would lose file pickers until the Windows app.
Decision: Leave neko's setting off. The agent reports an open picker (window "File Upload ...") in GET /profiles/:id/media; the phone offers "Choose file" (the phone's own chooser: camera, photos, files) and POSTs the file to /v1/profiles/:id/files; the agent copies it into the container (/tmp/from-phone/<random>/<name>, gone at stop) and types its path into the picker, only while the picker is the active window. The site sees the phone's file name.
Reason: PC file pickers keep working unchanged; no image change. The active-window check keeps a path from ever being typed into a page.

## 2026-10-31  A Docker hiccup no longer marks a running profile as crashed
Context: DockerRuntime.inspect returned null (container gone) for any error. When the Docker connection dropped for a moment (seen when the agent restarted), the monitor marked a running profile "The browser stopped unexpectedly" and removed its phone relays while the browser kept running; the start-up reconcile could likewise stop a healthy profile.
Decision: inspect returns null only for Docker's 404; other errors throw, and the monitor skips that round.
Reason: Only Docker saying the container doesn't exist means it's gone.

## 2026-10-31  Phone asks to share when a page wants the camera or mic
Context: Stage 4's permission flow: a page asking for the camera should make the phone offer it. Profiles grant camera and mic like a real Windows PC; the phone must learn that a page is using them.
Decision: The agent answers GET /v1/profiles/:id/media from inside the container (a short script run as neko): the camera is in use while a browser process maps the phone camera's shared memory, the mic while something records from the "microphone" source. The phone app asks every 2 s while it shows a profile and, when a page uses one it isn't sharing, offers "Share" (both in one request, so the phone asks once) or "Not now" (holds until the page lets go). No Camoufox or image change.
Reason: Works with the current image and browser build; reads what the browser really does, so it can't drift from it. Cost: about 0.5 s of docker exec per check, only while a phone has the profile open.

## YYYY-MM-DD  Short title
Context: ...
Decision: ...
Reason: ...
```

---

## 2026-10-31  Phone camera over TCP: no transport-cc, no videorate; mic track follows the source
Context: First end-to-end test with a simulated phone (Edge with Chromium's fake camera and mic driving the real phone app). (1) Any page asking for the microphone crashed its tab: MediaManager picks the track type from the device's IsFake(), so the identity device got a plain SourceMediaTrack, and the phone microphone source (a real MediaEngineWebRTCMicrophoneSource) dereferenced a null AudioProcessingTrack. (2) The camera worked but showed 2 to 78 frames a second from a 17 fps input: neko's videorate retimed frames by arrival time, which TCP bunches. (3) The phone sent only 320x180 at ~30 kbit/s, "limited by bandwidth" with no loss: phone streams reach neko over TCP (tailscale serve, see "Phone access" 2026-10-27), and the delay-based estimate (transport-cc) read the bunched arrivals as congestion. With transport-cc removed from the answer (tested by editing the SDP in the simulated phone), Chrome reached 1280x720 at full rate within 25 s.
Decision: enclave-camoufox: MediaManager chooses the microphone track by the source's IsFake() (two places, getUserMedia and track clone). neko patch: the pipe sink has no videorate (every decoded frame written as it comes); without neko's estimator (Enclave never enables it) Pion's default interceptors are registered without the transport-cc generator, so the phone falls back to loss-based control.
Reason: Fixes each fault where it starts, changes nothing for the stock fake devices or for neko's v4l2 path, and works for any phone browser (the change is on the server).

## 2026-10-30  Stage 4 design: camera and mic through Camoufox's media engine
Context (verify first): WSL kernel 6.18.33.2 has V4L2 only as modules and no v4l2loopback, no /dev/video. neko 3.2.0 receives the viewer's mic into a PulseAudio source (audio_input, works without kernel modules) but writes the webcam only to a v4l2loopback device (v4l2sink, hard-coded; VP8 tested). Camoufox serves the identity's cameras and mics from Firefox's fake media engine (media-device-spoofing.patch), which outputs a test pattern and tone. The neko client library shares any local track over the existing WebRTC connection.
Decision: Browser-level route, as the stage spec prefers. Phone PWA shares camera and mic over the viewer's neko WebRTC connection. Mic: neko's audio_input source; an enclave-camoufox patch makes the identity's microphone capture from it. Camera: a neko patch writes the decoded frames to a shared-memory file instead of v4l2sink; an enclave-camoufox patch makes the identity's camera show those frames. The device list stays the one saved in the profile.
Reason: Works on any Windows PC (no kernel module), keeps the Stage 3 device list, and keeps the real person's live camera as the only source (hard rule 6: nothing aimed at identity or liveness checks).

## 2026-10-30  Fonts only from fontconfig; one WebGL recording per GPU
Context: Kerned text in Verdana and Tahoma differed from Windows by 1/60 px; Firefox's bundled fonts (activated by Camoufox for a foreign OS) added every OS group on Linux, and the macOS Verdana won. Separately, Camoufox picks a WebGL recording at random; one of the three for Intel HD Graphics 400 reports MAX_SAMPLES 8, the real GPU 16.
Decision: gfx.bundled-fonts.activate=0 (fonts come only from Camoufox's Windows fontconfig file). gen_fingerprint uses the most common recording for the GPU and always 0 touch points. Existing profiles keep their saved values; Profile 1 (MAX_SAMPLES 8, touch 5) is left for the owner.
Reason: Every audit check now equals Windows Firefox 158 on this PC; all profiles on one PC report the same real GPU.

## 2026-10-27  Own Camoufox build for Windows text metrics (owner: yes, private repo)
Context: Linux Firefox measures text with FreeType rules (whole-pixel glyph heights, hhea line metrics, outward rounding); Windows Firefox with DirectWrite rules. Sites can measure the difference; no setting changes it. The owner's PC cannot build Firefox (WSL unsupported upstream, ~9.5 GB free).
Decision: A private GitHub repo `enclave-camoufox` (Camoufox at tag v158.0-beta.40, branch `enclave`) adds browser/patches/enclave-windows-font-metrics.patch: in gfxFT2FontBase, when ENCLAVE_FONT_METRICS=dwrite, HarfBuzz scales design advances, font metrics follow gfxDWriteFont::ComputeMetrics, glyph bounds are the design box. Built by a manual GitHub Actions workflow (Camoufox's own release steps, Linux x86_64 only). The image takes the zip from the local cache with its SHA-256 pinned. Camoufox's release/test workflows are removed from the copy.
Reason: Exact Windows numbers need Firefox code; GitHub's free runners are what Camoufox itself builds on. Private keeps the patches from competitors. Camoufox is MPL-2.0: when Enclave is sold, the modified files' source must be offered to buyers (docs/07 legal, later).

## 2026-10-27  WebRTC IP and geolocation come from each start's proxy check
Context: After a proxy change, WebRTC still reported the IP saved at creation (Pixelscan: proxy detected). A sticky IP that renews would do the same, and the saved location may be another city.
Decision: The agent passes the exit IP and its GeoIP location from the check it runs before every start (ENCLAVE_EXIT_IP/LAT/LON); launch_browser.py puts them into webrtc:ipv4 and geolocation. A proxy change also moves the saved geolocation. Country and timezone must still match, or the start is refused as before.
Reason: Hard rule 3: what the browser reports must agree with the IP websites see. Treated as the "Update location" exception in specs/profile-schema.md; the rest of the fingerprint stays fixed.

## 2026-10-27  Reference for "looks like Windows": real Firefox on the owner's PC
Context: Recorded values (Camoufox's device recordings, CreepJS's known lists) disagreed with each other and with what a current Windows Firefox reports (stencil masks, extension list).
Decision: The reference is the same Firefox version as Camoufox's base, official Mozilla build (checksum-verified), unpacked (not installed) and run headless with a throwaway profile on the owner's PC, which has the GPU the profiles claim. Compare with scripts/fingerprint/probe.html and CreepJS; per-machine values (screen, timezone, fonts the PC happens to have) are excluded.
Reason: It is what a real visitor with this hardware shows, value for value.

## 2026-10-27  Unhinted text rendering for Windows profiles
Context: Camoufox's Windows fontconfig sets full hinting, which rounds glyph advances to pixels (Windows uses exact advances) and broke one emoji's bounds.
Decision: The image switches hinting off (hinting false, hintnone) in the bundled Windows fonts.conf before Camoufox writes its runtime copy.
Reason: Widths then equal Windows Firefox's exactly in 9 of 10 fonts tested; the emoji bounds anomaly disappears.

## 2026-10-27  GL shim for Windows stencil masks, instead of waiting for Camoufox
Context: CreepJS flagged WebGL "suspicious capabilities": four stencil masks read 255 (Mesa) next to a Windows GPU, where Windows Firefox (ANGLE) reads 2147483647, confirmed on this PC's own Windows Firefox. Firefox takes them from the driver at context setup, outside Camoufox's override.
Decision: A small preloaded library (`images/browser/gl_shim.c`, built in its own Dockerfile stage with pinned gcc, set as LD_PRELOAD by launch_browser.py) wraps glGetIntegerv, found through dlsym/eglGetProcAddress, and answers all-ones masks as Windows Firefox 158 reports them (4294967295; see the reference entry above). It must not make any extra GL call (a GL error makes Firefox refuse WebGL). The Camoufox issue is not filed.
Reason: Fixes the flag now, for all profiles, without a Firefox rebuild; values a page sets itself are cached by Firefox and unaffected.

## 2026-10-27  Every new profile has one built-in camera
Context: Stage 3 asks for a consistent device list with a camera. Camoufox draws a Windows machine's devices from its own catalogue and gives it a built-in camera about 78% of the time, so some profiles have none. Stage 4 passes the phone camera through, which needs a camera in the list; adding one later would change a saved fingerprint (hard rule 2).
Decision: gen_fingerprint.py keeps Camoufox's draw and, when it has no camera, adds one built-in camera picked from Camoufox's Windows list by its weights (IR camera excluded), in its own device group. Profiles 1 and 2 predate this and have no camera; Stage 4 decides for them.
Reason: A camera stays realistic (most Windows laptops have one) and keeps camera passthrough possible without changing fingerprints later.

## 2026-10-27  Fingerprint baselines from a probe page
Context: The checklist asks for per-profile baselines and a regression check after relaunch or image upgrade. A page in the sealed container cannot reach the host.
Decision: `scripts/fingerprint/baseline.mjs` copies `probe.html` into the container, opens it through the stream's control API, and reads the JSON the page downloads (then deletes it). It saves `profiles/<id>/baselines/baseline.json` and compares later runs with it, canvas excepted. Canvas uniqueness is checked on a website (BrowserLeaks), because Firefox Strict does not randomize the canvas on file:// pages.
Reason: Needs nothing new in the image or the agent, and does not touch the profile's network.

## 2026-10-27  Phone app: home-screen shortcut, not a WebAPK install
Context: Android Chrome's "Install" hung at "Installing". Chrome turns an installed web app into a WebAPK on a Google server, which fetches the manifest and icons from the site; the app is reachable only inside the owner's tailnet.
Decision: Keep the app private and use Chrome's "Add to home screen → Create shortcut" (works). Do not expose the app publicly (e.g. Tailscale Funnel) to make WebAPK minting work.
Reason: Exposing the agent's address to the internet for a nicer icon would weaken the "only your devices can reach the PC" design. Revisit with Stage 6's own phone linking.

## 2026-10-27  Phone access: tailscale serve, not binding to the Tailscale interface
Context: Stage 2 "verify first" asks whether to expose streams with `tailscale serve` or by binding neko's ports to the Tailscale interface. On the owner's PC Docker runs inside WSL, whose published ports reach Windows on 127.0.0.1 only, so they cannot be bound to the Tailscale IP.
Decision: Streams stay bound to 127.0.0.1. In phone mode (`ENCLAVE_PHONE=tailscale`) the agent runs `tailscale serve --bg` for each running profile (`--https=<web port>` and `--tcp=<mux port>`) and for itself (`--https=<agent port>`, which also serves the phone app), and removes them on stop. Verified: HTTPS on custom ports works with Tailscale's certificate; TCP relay reachable from the tailnet. neko advertises a single address (the PC's Tailscale IP in phone mode, else 127.0.0.1): with two, pion keeps only the first ("overlapping address rewrite rule"), which left the phone with 127.0.0.1. The PC reaches its own Tailscale IP through the same relay. neko's CORS allows only the phone app's origin.
Reason: Works the same on Docker Desktop and on Docker Engine in WSL, never listens beyond loopback, and gives HTTPS (needed to install the app and, in Stage 4, for camera and microphone).

## 2026-10-26  Profiles render on the PC's GPU and behave as Firefox Strict (owner: option A)
Context: Acceptance found (1) the plain WebGL RENDERER showed the container's "llvmpipe" while the unmasked one claimed another GPU, and (2) canvas and WebGL output was identical for all profiles and rare (software rendering). Camoufox removed canvas noise on purpose (#528, #860: noise is something stock Firefox never shows) and covers the canvas with random data whenever the identity's GPU differs from the rendering one. Nothing available gives a canvas that is genuine, different per profile and stable across restarts at once; a stable seed would need patching and rebuilding Firefox (not feasible on the owner's PC). The owner chose option A.
Decision:
- Camoufox 158.0-beta.40 with the camoufox 0.5.9b5 package (fixes the RENDERER/UNMASKED pair, #839/#846).
- Profiles render on the PC's real GPU: the container gets /dev/dxg and WSL's /usr/lib/wsl, Mesa's d3d12 driver (already in the base image) with GALLIUM_DRIVER=d3d12, and Camoufox's GPU prefs. Verified on the owner's Intel HD Graphics 620: plain RENDERER no longer llvmpipe.
- Each profile claims that GPU as Windows Firefox names it: windows_gpu.py ports Firefox's SanitizeRenderer (HD Graphics 620 -> "Intel(R) HD Graphics 400"), with Camoufox's recorded parameters (webgl_config, canvas_noise=False). The agent detects the adapter through Windows (ENCLAVE_GPU picks one on multi-GPU PCs), saves it as fingerprint.webgl.hostAdapter, and refuses to start a profile on a different GPU (GPU_UNAVAILABLE).
- Every profile is Firefox with Enhanced Tracking Protection "Strict", set as a user pref in user.js so Firefox applies the whole category itself. Its fingerprinting protection randomizes canvas per profile, per site and per browser start (verified: BrowserLeaks signature changed across a restart). The fingerprint stores what Strict reports on Windows: available screen = screen minus a 48 px taskbar (nsRFPService::GetSpoofedScreenAvailSize; the browser computes it itself); tiered core counts; touch points 0 (a desktop; set explicitly, or neko's touch device shows as 5). The virtual desktop is built to match instead of spoofed (Camoufox 158 reports the real window): no desktop margins, the window placed at the fingerprint's position and size, no border. The browser language is the country's official language Firefox ships in, English where English is official (check_proxy.py; Camoufox's population-weighted pick gave Nigerian Pidgin).
- Audio is stock (no noise): every x86 PC renders the standard probe the same, and Firefox adds none.
- Acceptance tests 3 and 5 reworded accordingly (stages/stage-1-local-core.md).
Reason: All values are genuine or exactly what a real Firefox Strict user shows; profiles cannot be linked by canvas; no Linux software renderer is visible. Costs: all profiles on one PC claim the same GPU (as one real PC does), canvas changes per session (as for every Strict user), profiles are tied to the PC's GPU.

## 2026-10-26  More screen sizes
Context: All profiles had 1920x1080. neko's display modes lack common Windows sizes.
Decision: Profiles get a weighted random size from 1920x1080, 1366x768, 1600x900, 1440x900, 1680x1050 (all at 100% scaling, at most 1080p so streaming stays light). The image adds 30 Hz modes for the missing ones (1366 wide written by hand; gtf rounds to 1368).
Reason: A realistic spread instead of one size for every profile.

## 2026-10-26  Agent: reaching Docker, profile store, stream logins
Context: The owner's PC has no Docker Desktop and no docker.exe; Docker Engine runs in WSL. The agent must work with both (CLAUDE.md).
Decision: With Docker Desktop, dockerode uses its pipe. Otherwise the agent opens a private named pipe and, for each connection, runs `wsl.exe -d <ENCLAVE_WSL_DISTRO> -u root -- docker system dial-stdio` (no extra package, no TCP port, ~0.1 s per call). It holds WSL open while it runs. Profiles live in `%LOCALAPPDATA%\Enclave\profiles\<id>\` (override `ENCLAVE_HOME`); browser data in a Docker volume per profile. Config goes into the container with putArchive (no bind mounts, so no Windows path translation). The proxy check and fingerprint run in one-off containers of the image. neko gets fresh random passwords at every start; viewers get the normal (non-admin) one, which can control but not resize the screen. Stream ports: pairs from 52100 on 127.0.0.1. Containers get 3 GB memory and no-new-privileges.
Reason: One code path for both Docker setups, nothing listening on the network, and no secrets on command lines. Moving to Docker Desktop later needs no change.

## 2026-10-26  Test proxy profiles skip the real-IP check
Context: The safety check refuses a proxy whose exit IP is the PC's own (REAL_IP_LEAK_SUSPECTED). The dev test proxy (`scripts/test-proxy.sh`) exits through the PC by design.
Decision: Profiles created with `useTestProxy` are marked `runtime.usesTestProxy` and labeled "Test proxy, not for real accounts"; for them only, the real-IP check warns instead of refusing. Changing the proxy clears the mark.
Reason: Lets Stage 1 be exercised end to end without a paid proxy, without weakening the check for real profiles.

## 2026-10-26  Egress lock: iptables inside the profile container
Context: docs/04-security.md offers an in-container firewall or a sidecar container. Both have to work on Docker Engine in WSL and on Docker Desktop.
Decision: In-container iptables, applied by the entrypoint as root before anything else starts (`apply_egress_lock.sh`). Outbound policy DROP; allowed: loopback, replies to inbound connections (the viewer's stream), and new TCP from uid 1100 (`egress`, the gost forwarder) to the proxy's IP and port only. Docker's embedded DNS (127.0.0.11) is refused; all IPv6 out is refused. The proxy hostname is resolved once before the lock and gost dials the IP. The container needs `--cap-add NET_ADMIN`; the entrypoint then drops NET_ADMIN and NET_RAW from the bounding set (capsh) before exec'ing supervisord, so no process in the container can lift the lock. If the lock fails, the container exits and the browser never starts.
Reason: One container per profile stays simple for the agent, and the rules are verified on the owner's PC. A sidecar would double the containers and networks per profile for no extra protection here.

## 2026-10-26  Google as default search engine
Context: Camoufox's policies.json removes all search engines and sets a dummy "None", so searches typed in the address bar go nowhere.
Decision: A build step rewrites that policy to add Google as the default (Firefox's own default). Search engines are not visible to websites, so the fingerprint is unaffected.
Reason: Usability; the owner expects address-bar search to work.

## 2026-10-26  No canvas seed; fixed 1920x1080 screen for Stage 1
Context: Camoufox 156.0.1-beta.32 removed canvas noise on purpose (Camoufox issue #528; its config marks `canvas:seed` as removed). neko's virtual display only supports a fixed list of sizes (1920x1080, 2560x1440, 1600x900, ...; not 1366x768 or 1536x864).
Decision: `canvasSeed` is now optional in the schema, spec and types, and new fingerprints have none. Canvas output is therefore stable per profile (acceptance test 5) but the same for all profiles on one image (acceptance test 3 asks for different canvas values; flagged for the owner, Stage 3 decides). All Stage 1 fingerprints use a 1920x1080 screen (Camoufox `Screen` bound), and the window is reported maximized in the available area. `hardware.memoryGb` and `geolocation.accuracy` are optional too, because Camoufox doesn't produce them.
Reason: Follow Camoufox's current design rather than re-add a noise layer its authors removed. Stage 3 can add display modes and revisit canvas.

## 2026-10-26  Browser image: verified versions and pins
Context: Stage 1 "Verify first" for neko and Camoufox.
Decision: Base `ghcr.io/m1k1o/neko/base:3.2.0` pinned by digest (Debian 13, Python 3.13, supervisord as root, user `neko` uid 1000, `DISPLAY=:99.0`). Custom programs go in `/etc/neko/supervisord/*.conf` with openbox, as in neko's Firefox app. camoufox Python package 0.5.8 (plus a full `requirements.lock` installed with `--no-deps`), which pins browser build 156.0.1-beta.36. The browser zip, the GeoIP AIO database (release 2026.10.21), uBlock Origin 1.75.0 and gost 3.3.1 are downloaded by exact URL with `ADD --checksum` and laid out the way `camoufox fetch` would, because `fetch` takes "latest" for the add-on and GeoIP. The fpgen model is pinned and checksummed by camoufox itself (`ensure_fpgen_model`). Debian packages are pinned to exact versions; when Debian drops an old version, bump the pin.
Reason: CLAUDE.md requires exact pins, and `camoufox fetch` alone isn't reproducible.

## 2026-10-26  Fingerprint saved as Camoufox's full config; browser launched directly
Context: The fingerprint must never be regenerated (hard rule 2). Camoufox's Python launcher generates a fingerprint and passes it to the browser as `CAMOU_CONFIG_<n>` environment variables, with Firefox prefs in `CAMOU_PREFS_<n>`.
Decision: `gen_fingerprint.py` runs `launch_options()` once at creation and saves the decoded config and prefs as `fingerprint.raw`. `launch_browser.py` rebuilds those environment variables from the saved data and execs `camoufox-bin` directly, with `--profile /data/profile`. Playwright is not used at runtime.
Reason: Replays exactly what was saved, with no generation at launch. A browser for a person doesn't need an automation channel, and normal Firefox session restore keeps working.

## 2026-10-26  Local proxy forwarder (gost) inside each profile container
Context: Firefox can't authenticate to SOCKS5 proxies, and HTTP proxy authentication shows a login dialog.
Decision: gost 3.3.1 runs as a separate `egress` user (uid 1100) and listens on 127.0.0.1:1080 as plain SOCKS5. It forwards to the profile's proxy (socks5, http or https) with the credentials from `/config/proxy.json`. Camoufox uses only that local port, with remote DNS. The gost config holding the password is written to `/run/enclave` and readable only by `egress`.
Reason: Works for every proxy type without dialogs. It also gives task C's firewall one simple rule: only uid 1100 may reach the proxy host and port.

## 2026-10-26  Docker Engine inside WSL instead of Docker Desktop (owner's PC)
Context: The owner's PC runs Windows 11 21H2 (build 22000). Docker Desktop 4.96.3 needs 23H2 (build 22631) or newer, and the Windows 11 Installation Assistant reports the hardware as not compatible, so Windows cannot be upgraded.
Decision: Install WSL 2.7.14 plus an Ubuntu 24.04 distro, and run Docker Engine (pinned versions) inside it. The agent reaches Docker through that engine instead of Docker Desktop's named pipe. Product users on supported Windows may still use Docker Desktop, so the agent must support both connection methods.
Reason: The only supported way to get Docker on this PC. Stage 7 already plans a bundled WSL distro running Docker Engine, so this keeps the product path open.
Installed: WSL 2.7.14 (kernel 6.18.33.2-2), distro `Ubuntu-24.04` (default distro, default user root, systemd on), docker-ce/cli 5:29.9.2, containerd.io 2.4.2, buildx 0.38.1, compose 5.6.1, all held with `apt-mark hold`. `%UserProfile%\.wslconfig` sets `[general] instanceIdleTimeout=-1` so WSL doesn't shut the distro down (and with it all running profiles) after 15 s without a terminal attached. From Windows: `wsl docker <args>`.
Open for task D: how dockerode reaches this engine (the options are a TCP socket on 127.0.0.1 forwarded from WSL, or running `wsl docker` commands), and starting the distro after a reboot (the agent can run `wsl -d Ubuntu-24.04 true` before talking to Docker).

## 2026-10-25  Node 24 LTS instead of Node 20
Context: Docs say Node 20 LTS. Node 20 reached end of life in April 2026; the owner's PC has Node 24.14.1.
Decision: Target Node 24 LTS (`engines: >=24 <25`). Agent and relay use it; Electron (Stage 5) brings its own Node.
Reason: Node 20 no longer gets security fixes. Node 24 is the active LTS line and is already installed.

## 2026-10-25  pnpm through corepack, pinned
Context: pnpm is not installed on the owner's PC.
Decision: Root `package.json` pins `"packageManager": "pnpm@12.15.0"`. Run it as `corepack pnpm <cmd>` (or run `corepack enable` once in an admin PowerShell, then plain `pnpm`).
Reason: No global install needed, and everyone gets the same pnpm version.

## 2026-10-25  Tooling versions for task A
Context: CLAUDE.md requires exact pins. TypeScript 7.0 (the native Go compiler) is out, but typescript-eslint 8.72.0 only supports TypeScript `<6.1`.
Decision: TypeScript 6.0.3, ESLint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.72.0, eslint-config-prettier 10.1.8, Prettier 3.9.10, Vitest 5.0.5, globals 17.13.0, @types/node 24.19.2. Move to TypeScript 7 once typescript-eslint supports it.
Reason: Lint must work. TypeScript 6.0 is the newest version every tool supports.

## 2026-10-25  `@enclave/shared` builds to dist with project references
Context: Consumers include the agent (plain Node), Electron and Vite apps. Node won't strip types inside node_modules, so it can't run `.ts` files from a workspace package.
Decision: `packages/shared` is ESM and compiled by `tsc -b` to `dist/`. Other packages reference it as a TypeScript project reference. `src/contract.test.ts` checks the shared enums against `specs/schemas/profile.schema.json`.
Reason: Works the same for every consumer without extra loaders. The test catches drift between the types and the schema.

## 2026-10-25  Agent API gaps filled
Context: `specs/agent-api.md` did not define the shape of `ram` in `/system` or how DELETE passes its confirm flag.
Decision: `ram` is `{ totalBytes, freeBytes }`. DELETE requires the query `?confirm=true`. The spec is updated to match.
Reason: Simplest shapes. A query flag also works with clients that drop DELETE bodies.

## 2026-10-25  Initial architecture locked
Context: Choosing how PC-to-phone continuity works.
Decision: Profiles run in Docker on the user's PC; phone and PC are both viewers of the one running browser. No profile-data sync between devices.
Reason: Avoids the fingerprint mismatch of syncing a desktop profile onto a mobile browser, keeps running cost near zero, and makes continuity exact (nothing to desync).

## 2026-10-25  Engine choice: Camoufox
Context: Need engine-level fingerprinting without patching Chromium.
Decision: Use Camoufox (Firefox based) as the browser engine.
Reason: Open source, engine-level spoofing, built-in realistic fingerprint generation. Present all profiles as Windows Firefox to avoid engine/UA mismatch.

## 2026-10-25  Streaming: neko v3
Context: Need to view the container browser on PC and phone.
Decision: Build the browser image on neko v3's base image.
Reason: Self-hosted WebRTC streaming, low latency, audio, works in phone browsers; permissive license.

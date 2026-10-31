# Phone tests (Stage 4)

Tools for testing the phone as a camera, mic, clipboard and file source for a profile. Use a throwaway profile made with `--test-proxy` (or "Phone test"), never a real account's profile.

Where a script says "run where docker runs", on the owner's PC that is inside WSL as root, for example from PowerShell:

```
wsl -d Ubuntu-24.04 -u root bash "/mnt/c/GJ Projects/enclave/scripts/phone/black-frames.sh" <profile id>
```

## What is here

| Tool | What it does |
|---|---|
| `sim/phone-sim.mjs` | A simulated phone: headless Edge with Chromium's fake camera and mic runs the real phone app over Tailscale, opens a profile, shares Mic and Camera and runs scripted steps (Flip, Paste, file choice, pinch zoom, WebRTC stats, round trip). Steps are listed at the top of the file. |
| `sim/*cam.js` | Test cameras for the simulated phone: `clockcam` (the phone clock as a barcode, for delay), `portraitcam` (an upright phone with a round circle, for shape), `stallcam` (a camera that pauses, for gaps). |
| `pages/phone-check.html` | For a person on the real phone: camera and mic with a level meter, the PC clock, a code to copy to the phone, a box to paste into, and an upload field that says whether the file still carries a location. Open it with `open-page.sh <id> phone-check.html`. |
| `pages/media-test.html` | For the simulated phone: records what the profile's camera and mic deliver (device labels, settings, picture brightness and movement, sound level) and saves it to `/data/downloads`. Open with `--no-prompt`. |
| `pages/file-test.html`, `pages/rt-test.html` | Upload field for file passthrough; barcode reader for the round trip (with `CLOCKCAM=1` and the `rt:` step). |
| `black-frames.sh` | Does the browser ever show a black frame between two good camera frames? Writes frames slowly (4 ms per write) and counts black frames in a page for 40 s. Expected `"black": 0`; with `--stopped`, every frame black. |
| `monitor.sh` | While someone tests: camera frames reaching the browser each second (new, held, dark, age), neko's connection events, and the phone's WebRTC TCP socket. Finds where a freeze or blackout comes from. |
| `open-page.sh` | Puts a page from `pages/` into a profile and opens it. |

## Stage 4 acceptance tests

| Test | How it is checked |
|---|---|
| 1. Live video | Real phone: `phone-check.html`, Start camera and mic, the picture moves. Simulated phone: `media-test.html` shows "HD Webcam" at 1280x720 with movement. Shape: `PORTRAITCAM=1` keeps the circle round. No blackouts: `black-frames.sh` (both modes) and `monitor.sh` during a real-phone test. |
| 2. Front/back | Real phone: Flip while `phone-check.html` shows the camera. Simulated phone: step `flip`, the page's picture stays live. |
| 3. Mic | Real phone: the level meter in `phone-check.html` follows your voice. Simulated phone: `media-test.html` hears the fake mic's ~400 Hz beeps. |
| 4. Latency | Real phone: judged by a person (move, watch the picture). Simulated phone: `CLOCKCAM=1`, `rt-test.html` and the `rt:` step give the round trip on the phone clock. |
| 5. Clipboard | Real phone: Copy in `phone-check.html`, paste in another phone app; copy on the phone, Paste into the page's box. Simulated phone: steps `cliprd`, `pastebtn:`, `iosclip`, `copied`, `tapcopy`. |
| 6. File | Real phone: Browse... in `phone-check.html`, then Choose file on the phone; the page shows the photo and "Location in file: none". The agent log (`profiles/<id>/agent.log`) shows `phone-file` with `locationRemoved`. Simulated phone: `file-test.html` and `choosefile:`. |
| 7. No phone | With no phone sharing, `media-test.html` gets a black camera and silence and nothing crashes. The PC message is Stage 5 (the Windows app reads `GET /profiles/:id/media`). |

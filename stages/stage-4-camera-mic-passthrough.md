# Stage 4: Camera and mic passthrough

**Goal:** when a page inside a profile asks for the camera or microphone, the user's real phone camera and mic feed into it live, in real time. Also add clipboard and file passthrough.

**Guardrail (from CLAUDE.md, repeated because it matters here):** this feature carries the real person's live phone camera and mic into the profile. Do not build, tune, research or document anything whose purpose is to defeat identity verification, liveness detection, or virtual camera / injected stream detection. Do not market it as passing ID checks. If the owner asks for that, decline and point here.

## Verify first
- Confirm whether `v4l2loopback` works under the current WSL 2 kernel (assume no unless proven). If not, use the browser level approach below.
- Camoufox/Firefox support for providing a media stream to `getUserMedia`, and what neko already offers for upstream audio/video from the viewer.

## Approach
Prefer the **browser level** route over a virtual kernel device: when a page calls `getUserMedia`, supply the phone's incoming WebRTC track as the camera/mic, rather than creating a fake `/dev/video` device. Simpler, and it sidesteps the WSL kernel limitation. Keep the device list (Stage 3) consistent with what is offered.

## Build tasks
- [ ] Phone PWA: capture camera and mic with `getUserMedia`, show a live preview, allow front/back switch, and stream upstream over WebRTC to the profile container.
- [ ] Container side: route the incoming phone tracks so the profile browser receives them as its camera and microphone when a page requests them.
- [ ] Permission flow: a page requests camera -> phone prompts the user to share -> on confirm, the live feed appears to the site. Clear UI on the phone showing the camera is live.
- [ ] Latency target under ~300 ms; 720p30 default, adapt down on weak networks rather than freezing.
- [ ] Mic passthrough with the camera; keep audio and video in sync.
- [ ] Clipboard passthrough both directions (text at least).
- [ ] File passthrough: let the phone pick or capture a file and hand it to the profile's file picker.
- [ ] If camera is requested while viewing on PC (no phone attached), show a clear message: open on phone to use the camera, or use a webcam attached to the PC if present.

## Acceptance tests
1. **Live video:** open a page that shows your camera (a plain WebRTC camera test page) inside a profile; from the phone, the live feed appears and moves in real time.
2. **Front/back switch** works and the site sees the change.
3. **Mic:** a mic test page inside the profile shows levels from the phone mic.
4. **Latency:** movement lag is small enough to follow on screen prompts comfortably.
5. **Clipboard:** copy on PC, paste in the profile from the phone, and vice versa.
6. **File:** take a photo on the phone and attach it through a file upload field in the profile.
7. **Graceful absence:** request camera with no phone connected; the message is clear and nothing crashes.

# Reference: what a website measures about a camera

`scripts/phone/pages/camera-measure.html` in the official Firefox 158.0 (Mozilla's build, SHA-256 450ab1c7...f8d1, unpacked, fresh profile, camera permission granted by pref), on the owner's PC (HP laptop, Windows 11), 2026-11-04, 20 s of frames each, indoors in normal room light.

- `hp-hd-camera-firefox158.json`: the laptop's real camera ("HP HD Camera"). Claims 30 fps, delivers 16.6 (low-light rate): frame gaps p50 64 ms, p95 68 ms, max 111 ms, sd 8.8 ms. No two consecutive frames identical (sensor noise: mean difference 1.6 per pixel, never below 1.1 on a 64x36 copy); no black frames. Capabilities width 2 to 1280, height 2 to 720, frameRate 0 to 30; exact 1920 wide, exact 60 fps and exact facingMode environment are refused (OverconstrainedError); a second stream while one is open works.
- `manycam-virtual-firefox158.json`: ManyCam's virtual camera on the same PC, for contrast. 26.8 fps but gaps up to 590 ms (sd 34 ms), one frame identical to the one before, capabilities up to 3840x2160.

Before permission Firefox lists one videoinput and one audioinput with empty labels and ids, whatever is installed.

What gives a camera away is not its frame rate (a real webcam indoors runs well under what it claims) but long or uneven gaps, repeated identical frames and pure black frames.

`enclave-no-phone.json`: the same page in an Enclave profile (test proxy, the owner's PC), no phone sharing, 2026-11-04. Label, settings, capabilities and refusals equal the real camera's (this profile's cameras: "Lenovo EasyCamera" and "c922 Pro Stream Webcam"). But all 507 frames are pure black and 506 identical to the one before, at 25 fps with gaps up to 282 ms: no real camera does that.

# Measurement: real Firefox 158 on a tester's PC (Oladoyinbo)

`probe-default-gpu.json`: `images/browser/audit/probe.html` in the official Firefox 158.0 (Mozilla's `Firefox Setup 158.0.exe`, SHA-256 450ab1c7...f8d1, unpacked with /ExtractDir, fresh profile), on the tester's PC, 2026-11-04, Windows' default graphics choice for the browser.

- Firefox reported `ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar`: Firefox's name for most modern AMD Radeon chips (SanitizeRenderer, images/browser/windows_gpu.py). The tester's Enclave profile claims `GeForce GTX 980` (most modern NVIDIA cards): the agent takes the first adapter Windows lists, and the profile renders on that one. Likely a PC with two graphics chips (AMD in the processor, NVIDIA card); to confirm with the tester's adapter list.
- 16 cores, as the profile. MAX_VERTEX_UNIFORM_VECTORS 4096 (WebGL 1 and 2), as on the owner's Intel; the profile (Camoufox's GTX 980 recording) says 4095. Not comparable until a measurement on the NVIDIA card.
- audioSum 75.83002272993326; the profile reports 35.749972093850374, the common Firefox value and the owner's.

Personal settings in the file (screen, time zone, fonts, voices) are the tester's own and not used.

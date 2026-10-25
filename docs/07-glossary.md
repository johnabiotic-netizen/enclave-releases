# Glossary

- **Profile**: one sealed browser identity: fingerprint + proxy + data volume + settings.
- **Container**: the running Docker instance of a profile.
- **Volume**: persistent storage for a profile's browser data and `profile.json`.
- **Agent**: local Node service on the PC that manages profiles and containers.
- **Viewer**: anything that displays a profile's stream (PC browser, desktop app, phone).
- **Stream**: neko's WebRTC video, audio and input channel for one profile.
- **Safety check**: proxy verification before a profile starts.
- **Egress lock**: firewall that only allows a profile's traffic out through its proxy.
- **Relay**: cloud service for pairing phones with PCs and tunneling signaling (Stage 6).
- **TURN**: server that relays WebRTC media when a direct connection is impossible.
- **Passthrough**: phone camera and mic streamed live into a profile (Stage 4).
- **Idle stop**: automatic stop of a profile with no viewers for a set time.

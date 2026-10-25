# @enclave/agent

The local control service (Node + TypeScript). Manages Docker containers and profiles, runs proxy safety checks, generates fingerprints, assigns stream ports and passwords, stops idle profiles, and exposes the local API on 127.0.0.1 with token auth. Also provides the Stage 1 CLI. Embedded into the desktop app's main process in Stage 5. Build per `stages/stage-1-local-core.md` and `specs/agent-api.md`.

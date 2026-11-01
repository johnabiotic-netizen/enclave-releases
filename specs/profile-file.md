# Profile file (export and import)

One profile in one encrypted file, `<name>.enclave`, for a backup or a move to another PC.
Code: `packages/agent/src/profile-file.ts` (format), `ProfileService.exportProfile` and
`importProfile` (`packages/agent/src/profiles.ts`), the app's IPC handlers
(`packages/desktop/src/main/main.ts`) and `Transfer.tsx`.

## What it holds

- The profile as saved (`profile.json`), with its status reset: name, notes, proxy, the fixed
  fingerprint, runtime settings.
- The proxy password (from the sealed secrets), so the profile works after import.
- The browser data volume (`/data`: logins, cookies, open tabs, history, downloads), as a tar,
  without the browser's caches (`profile/cache2`, `profile/startupCache`) and its lock files.

Not in it: stream passwords (made fresh at every start), the agent log, phone pairings.

## Format

```
"ENCLAVE-PROFILE\n" | header length (uint32 BE) | header (JSON) | records
record    = final flag (1 byte, 0 or 1) | length (uint32 BE) | AES-256-GCM ciphertext and tag
plaintext = gzip( manifest length (uint32 BE) | manifest (JSON) | tar of /data )
```

- Header: `{ format: 1, kdf: { name: "scrypt", N: 131072, r: 8, p: 1, salt }, cipher:
  "aes-256-gcm", noncePrefix, chunk: 1048576 }`; salt 16 random bytes, nonce prefix 8.
- Key: scrypt of the passphrase (NFC), 32 bytes. Passphrase at least 10 characters.
- Records hold 1 MiB of plaintext (the last one less). Nonce: the 8-byte prefix and a 32-bit
  counter. Each record's additional data is the whole header plus its final flag.
- Opening refuses: a different magic or format, unknown costs, a record that doesn't
  authenticate (the first one: wrong passphrase), data after the final record, and a file with
  no final record (cut short).
- Manifest: `{ format: 1, exportedAt, appVersion, profile, secrets: { proxyPassword? } }`.

## Rules

- Export needs the profile stopped (its browser has then saved everything). The volume is
  read through a container that is created but never started, with the volume read-only.
- Import makes a new profile id, keeps everything else, and writes the volume the same way.
  Only `data/` entries are written; absolute paths and `..` are dropped.
- Import refuses a profile this PC already has (same fingerprint): two copies would be two
  devices with one identity.
- A profile only starts on a PC with the graphics card it was made on (`GPU_UNAVAILABLE`,
  hard rule 2). Import still works on another PC and says the profile can't start there.
- Export and import are not in the agent's HTTP API. The app calls the agent directly, with
  file paths from Windows' save and open dialogs. A phone in Tailscale mode holds the API token,
  and a route that writes or reads any path on the PC must not be reachable from it.
- Errors: `PROFILE_RUNNING`, `BAD_PROFILE_FILE`, `WRONG_PASSPHRASE`, `PROFILE_EXISTS`
  (`specs/agent-api.md`).

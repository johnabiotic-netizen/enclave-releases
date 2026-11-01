// Enclave's own Linux system for WSL (images/wsl): Debian with Docker Engine, imported as the
// distro "Enclave" on a PC that has no Docker. Then profiles run as with Docker Desktop, and
// the agent reaches the engine through WSL (packages/agent/src/docker/connect.ts).
//
// All WSL distros share one network, so this system is only set up on a PC with no Docker of
// its own (Docker Desktop, or Docker Engine in another distro), never next to one.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

export const SYSTEM_DISTRO = 'Enclave';
/** enclave-wsl.tar.gz from the enclave-camoufox workflow "Enclave WSL" (scripts/fetch-wsl-system.sh). */
export const SYSTEM_FILE = 'enclave-wsl.tar.gz';
export const SYSTEM_SHA256 = '6804165b37048a54aa98bb987ff91dacfe55b7f7f768310404deb1d0017234d6';

interface Run {
  code: number;
  out: string;
}

function run(file: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } },
      (err, stdout, stderr) => {
        const code = err ? ((err as { code?: unknown }).code as number) || 1 : 0;
        resolve({
          code: typeof code === 'number' ? code : 1,
          out: `${stdout}${stderr}`.replace(/\0/g, '').trim(),
        });
      },
    );
  });
}

/** The system file: beside the app when installed, packages/desktop/wsl/ in a developer run. */
export function systemFilePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'wsl', SYSTEM_FILE)
    : path.resolve(app.getAppPath(), 'wsl', SYSTEM_FILE);
}

/** Where WSL keeps the system's disk: the user's local app data, never roaming. */
function systemFolder(): string {
  const local = process.env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local');
  return path.join(local, 'Enclave', 'wsl');
}

export async function wslDistros(): Promise<string[]> {
  const list = await run('wsl.exe', ['--list', '--quiet'], 20_000);
  if (list.code !== 0) return [];
  return list.out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function engineUp(): Promise<boolean> {
  const r = await run(
    'wsl.exe',
    [
      '-d',
      SYSTEM_DISTRO,
      '-u',
      'root',
      '-e',
      'sh',
      '-c',
      'socat -u OPEN:/dev/null UNIX-CONNECT:/var/run/docker.sock && echo up',
    ],
    30_000,
  );
  return r.code === 0 && r.out.endsWith('up');
}

/**
 * Imports the system and waits until Docker answers in it. A failed attempt is removed again,
 * so Set up can simply be tried again. Messages are for the person.
 */
export async function installSystem(): Promise<void> {
  const file = systemFilePath();
  if (!existsSync(file)) {
    throw new Error("This copy of Enclave doesn't include its Linux system. Reinstall Enclave.");
  }
  if ((await sha256(file)) !== SYSTEM_SHA256) {
    throw new Error("Enclave's Linux system file is damaged. Reinstall Enclave.");
  }
  if ((await wslDistros()).includes(SYSTEM_DISTRO)) {
    if (await waitForEngine(60_000)) return;
    throw new Error(await engineProblem());
  }
  const folder = systemFolder();
  await mkdir(folder, { recursive: true });
  const imported = await run(
    'wsl.exe',
    ['--import', SYSTEM_DISTRO, folder, file, '--version', '2'],
    10 * 60_000,
  );
  if (imported.code !== 0) {
    throw new Error(
      `WSL couldn't set up Enclave's Linux system: ${imported.out || `code ${imported.code}`}. Check that WSL is on (the line above), then try again.`,
    );
  }
  if (await waitForEngine(90_000)) return;
  const problem = await engineProblem();
  await run('wsl.exe', ['--unregister', SYSTEM_DISTRO], 120_000);
  throw new Error(problem);
}

async function waitForEngine(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await engineUp()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function engineProblem(): Promise<string> {
  const log = await run(
    'wsl.exe',
    ['-d', SYSTEM_DISTRO, '-u', 'root', '-e', 'sh', '-c', 'tail -n 3 /var/log/dockerd.log'],
    30_000,
  );
  const last = log.out.split('\n').filter(Boolean).pop();
  return `Docker didn't start in Enclave's Linux system${last ? ` (${last.slice(0, 300)})` : ''}. Restart the PC, then try again.`;
}

/**
 * Runs as administrator. `wsl --install --no-distribution` turns on what WSL needs; Windows 10
 * builds whose own wsl.exe predates that option get the two Windows features turned on
 * directly. Then WSL itself is updated to the current release (from GitHub, not the Store).
 */
const TURN_ON_WSL = `
$ErrorActionPreference = 'Continue'
Write-Host 'Turning on WSL for Enclave. This window closes by itself.'
wsl.exe --install --no-distribution --web-download
if ($LASTEXITCODE -ne 0) {
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
}
wsl.exe --update --web-download
Start-Sleep -Seconds 3
`;

/** PowerShell's -EncodedCommand: UTF-16LE, base64. No quoting to get wrong. */
function encoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Turns WSL on: Windows asks for administrator permission, then installs it. A restart
 * finishes it. Resolves when the installer has closed.
 */
export async function turnOnWsl(): Promise<void> {
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded(TURN_ON_WSL)}'`,
    ],
    30 * 60_000,
  );
  if (r.code !== 0) {
    throw new Error(
      /canceled|cancelled/i.test(r.out)
        ? 'Windows asked for permission and it was declined. Click Turn on WSL again and choose Yes.'
        : `WSL couldn't be turned on: ${r.out || `code ${r.code}`}`,
    );
  }
}

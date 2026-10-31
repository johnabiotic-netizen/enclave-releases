// The setup checker (ui/screens.md, screen 1): what this PC has and what it is missing for
// Enclave, each with the exact fix (docs/setup/windows-setup.md). Runs in the main process,
// where Windows tools can be called.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SetupCheck } from '../shared/bridge.js';

interface Run {
  code: number;
  out: string;
}

function run(file: string, args: string[], timeoutMs = 20_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      // wsl.exe writes UTF-16 unless told otherwise.
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } },
      (err, stdout, stderr) => {
        const code = err ? ((err as { code?: unknown }).code as number) || 1 : 0;
        resolve({ code: typeof code === 'number' ? code : 1, out: `${stdout}${stderr}` });
      },
    );
  });
}

const PS = ['-NoProfile', '-NonInteractive', '-Command'];

async function virtualization(): Promise<boolean> {
  // A running hypervisor (WSL 2, Hyper-V) hides the firmware flag, so either one counts.
  const r = await run('powershell.exe', [
    ...PS,
    '$c = Get-CimInstance Win32_ComputerSystem; $p = Get-CimInstance Win32_Processor | Select-Object -First 1; "$($c.HypervisorPresent) $($p.VirtualizationFirmwareEnabled)"',
  ]);
  return /True/i.test(r.out);
}

interface Wsl {
  installed: boolean;
  version2: boolean;
  distros: string[];
}

async function wsl(): Promise<Wsl> {
  const status = await run('wsl.exe', ['--status']);
  if (status.code !== 0) return { installed: false, version2: false, distros: [] };
  const list = await run('wsl.exe', ['--list', '--quiet']);
  const distros = list.out
    .split(/\r?\n/)
    .map((l) => l.replace(/\0/g, '').trim())
    .filter(Boolean);
  return { installed: true, version2: /Default Version:\s*2/i.test(status.out), distros };
}

function dockerDesktopInstalled(): boolean {
  const programs = process.env.ProgramFiles ?? 'C:\\Program Files';
  return existsSync(path.join(programs, 'Docker', 'Docker', 'Docker Desktop.exe'));
}

/** Docker Engine is installed in the distro (running or not: that is the next check). */
async function dockerInWsl(distro: string): Promise<boolean> {
  const r = await run('wsl.exe', ['-d', distro, '-u', 'root', '--', 'which', 'dockerd']);
  return r.code === 0 && /dockerd/.test(r.out);
}

export interface AgentFacts {
  /** The agent is up and reached Docker. */
  dockerOk: boolean;
  imageBuilt: boolean;
  image: string;
  /** WSL distro running Docker Engine, on a PC without Docker Desktop. */
  wslDistro: string | undefined;
  /** Why the agent could not start, if it could not. */
  agentError: string | undefined;
}

export async function runSetupChecks(facts: AgentFacts): Promise<SetupCheck[]> {
  const [virt, w] = await Promise.all([virtualization(), wsl()]);
  const desktop = dockerDesktopInstalled();
  const engine = facts.wslDistro && w.distros.includes(facts.wslDistro);
  const engineDocker = engine ? await dockerInWsl(facts.wslDistro!) : false;
  const dockerInstalled = desktop || engineDocker;

  const checks: SetupCheck[] = [
    {
      id: 'virtualization',
      label: 'Virtualization on',
      ok: virt,
      detail: virt
        ? 'This PC can run virtual machines.'
        : "Virtualization is turned off in this PC's BIOS.",
      fix: [
        'Press Ctrl + Shift + Esc, open Performance and click CPU. If Virtualization says Disabled, it must be turned on in the BIOS.',
        'Restart the PC and open its BIOS setup (often F2, F10, Del or Esc right after power on).',
        'Turn on the setting called Virtualization, VT-x, SVM or AMD-V, save and restart. Steps vary by PC maker: search your PC model plus "enable virtualization".',
      ],
    },
    {
      id: 'wsl',
      label: 'WSL working',
      ok: w.installed && w.version2,
      detail: !w.installed
        ? 'Windows Subsystem for Linux is not installed.'
        : w.version2
          ? 'WSL 2 is installed.'
          : 'WSL is installed but not set to version 2.',
      fix: [
        'Click Start, type PowerShell, right click Windows PowerShell and choose Run as administrator.',
        'Run: wsl --update --web-download',
        'Run: wsl --install --no-distribution',
        'Restart the PC, then click Recheck.',
      ],
    },
    {
      id: 'docker-installed',
      label: 'Docker installed',
      ok: dockerInstalled,
      detail: desktop
        ? 'Docker Desktop is installed.'
        : engineDocker
          ? `Docker Engine runs in WSL (${facts.wslDistro}).`
          : 'Docker is not installed.',
      fix: [
        'Go to docker.com and choose "Download for Windows - AMD64" (right for Intel and AMD; not ARM64).',
        'Run the installer, keep the WSL 2 option checked, finish, and restart if asked.',
        'Open Docker Desktop. If it asks you to sign in, click Skip. No account is needed.',
      ],
    },
    {
      id: 'docker-running',
      label: 'Docker running',
      ok: facts.dockerOk,
      detail: facts.dockerOk
        ? 'Enclave can reach Docker.'
        : (facts.agentError ?? 'Enclave cannot reach Docker.'),
      fix: desktop
        ? [
            'Open Docker Desktop from the Start menu.',
            'Wait until the bottom left says "Engine running" in green, then click Recheck.',
            'Leave Docker Desktop open whenever you use Enclave.',
          ]
        : [
            `Open PowerShell and run: wsl -d ${facts.wslDistro ?? 'Ubuntu-24.04'} -u root -- service docker start`,
            'Then click Recheck.',
          ],
    },
    {
      id: 'image',
      label: 'Browser ready',
      ok: facts.imageBuilt,
      detail: facts.imageBuilt
        ? `The secure browser (${facts.image}) is set up.`
        : facts.dockerOk
          ? 'The secure browser is not set up on this PC yet.'
          : 'Checked once Docker is running.',
      fix: [
        'The secure browser is set up once per PC and takes about 5 to 10 minutes.',
        'On this build it is set up from the Enclave source folder: in PowerShell, run .\\scripts\\build-image.ps1, then click Recheck.',
      ],
    },
  ];
  return checks;
}

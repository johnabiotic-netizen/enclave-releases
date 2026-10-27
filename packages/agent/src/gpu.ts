// The PC's graphics card, which profiles render on (through WSL's D3D12 driver) and
// therefore claim. See images/browser/windows_gpu.py and DECISIONS.md.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Adapters Windows lists that cannot render a browser. */
const NOT_A_GPU =
  /Microsoft Basic|Remote Display|Virtual|Parsec|Citrix|DisplayLink|Mirage|Meta Virtual/i;

/**
 * The adapter profiles render on, as Windows names it (e.g. "Intel(R) HD Graphics 620").
 * `override` (ENCLAVE_GPU) picks one by name on a PC with several; otherwise the first
 * real one Windows lists, which is the adapter D3D12 uses by default. null when there is
 * none or this is not Windows.
 */
export async function detectGpu(override?: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq "OK" }).Name',
    ],
    { windowsHide: true, timeout: 30_000 },
  );
  const names = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !NOT_A_GPU.test(s));
  if (override) return names.find((n) => n.toLowerCase().includes(override.toLowerCase())) ?? null;
  return names[0] ?? null;
}

/** Container settings that give a profile the GPU (WSL's /dev/dxg and its D3D12 libraries). */
export function gpuContainerSettings(adapter: string) {
  return {
    env: [
      'ENCLAVE_GPU=1',
      'LD_LIBRARY_PATH=/usr/lib/wsl/lib',
      'GALLIUM_DRIVER=d3d12',
      `MESA_D3D12_DEFAULT_ADAPTER_NAME=${adapter}`,
    ],
    devices: [{ PathOnHost: '/dev/dxg', PathInContainer: '/dev/dxg', CgroupPermissions: 'rwm' }],
    mounts: [
      { Type: 'bind' as const, Source: '/usr/lib/wsl', Target: '/usr/lib/wsl', ReadOnly: true },
    ],
  };
}

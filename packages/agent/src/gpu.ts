// The PC's graphics adapters, which profiles render on (through WSL's D3D12 driver) and
// therefore claim. See images/browser/gl_info.py and DECISIONS.md.
//
// A new profile takes the adapter a browser gets on this PC: DXGI's first adapter, the
// one Windows hands a program by default (on a laptop with two chips, the power-saving
// one: what the tester's Firefox 158 used, DECISIONS 2026-11-04). It is named as Firefox's
// ANGLE names it, "<name> (0x<device id>)", because Firefox maps that whole string to the
// card it reports (an AMD "Radeon(TM) Graphics" becomes "Radeon R9 200 Series" through the
// digits of its id). A profile afterwards always uses the adapter it was made on, wherever
// Windows lists it.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Adapters Windows lists that cannot render a browser. */
const NOT_A_GPU =
  /Microsoft Basic|Remote Display|Virtual|Parsec|Citrix|DisplayLink|Mirage|Meta Virtual/i;

export interface GpuAdapter {
  /** As Windows names it, e.g. "Intel(R) HD Graphics 620". */
  name: string;
  /** PCI device id, four hex digits (e.g. "5916"); null when Windows didn't say. */
  deviceId: string | null;
}

/**
 * DXGI's adapters in the order programs get them (adapter 0 first), hardware only:
 * "<description>\t<device id>" per line. PowerShell compiles a few lines of C# that call
 * IDXGIFactory1::EnumAdapters1 and IDXGIAdapter1::GetDesc1 through their vtables.
 */
const DXGI_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EnclaveDxgi {
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Desc1 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId, DeviceId, SubSysId, Revision;
    public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
    public uint LuidLow; public int LuidHigh; public uint Flags;
  }
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumAdapters1(IntPtr self, uint index, out IntPtr adapter);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc1(IntPtr self, out Desc1 desc);
  static T Slot<T>(IntPtr obj, int slot) {
    IntPtr vtable = Marshal.ReadIntPtr(obj);
    return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vtable, slot * IntPtr.Size), typeof(T));
  }
  public static string List() {
    Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    IntPtr factory;
    if (CreateDXGIFactory1(ref iid, out factory) != 0) return "";
    var sb = new System.Text.StringBuilder();
    // IUnknown 3 + IDXGIObject 4 + IDXGIFactory 5: EnumAdapters1 is slot 12.
    var enumAdapters = Slot<EnumAdapters1>(factory, 12);
    for (uint i = 0; i < 16; i++) {
      IntPtr adapter;
      if (enumAdapters(factory, i, out adapter) != 0) break;
      // IUnknown 3 + IDXGIObject 4 + IDXGIAdapter 3: GetDesc1 is slot 10.
      Desc1 d;
      if (Slot<GetDesc1>(adapter, 10)(adapter, out d) == 0 && (d.Flags & 2) == 0) {
        sb.Append(d.Description).Append('\\t').Append(d.DeviceId.ToString("X4")).Append('\\n');
      }
      Marshal.Release(adapter);
    }
    Marshal.Release(factory);
    return sb.ToString();
  }
}
'@
[Console]::Out.Write([EnclaveDxgi]::List())
`;

function encoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function powershell(args: string[]): Promise<string> {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], {
    windowsHide: true,
    timeout: 60_000,
  });
  return stdout;
}

/** Parses "<name>\t<device id>" lines, dropping adapters that can't render a browser. */
export function parseAdapterLines(text: string): GpuAdapter[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .map(([name, id]) => ({
      name: (name ?? '').trim(),
      deviceId: id && /^[0-9A-Fa-f]{4}$/.test(id.trim()) ? id.trim().toUpperCase() : null,
    }))
    .filter((a) => a.name && !NOT_A_GPU.test(a.name));
}

/** The PC's adapters, the one programs get by default first. Empty when not on Windows. */
export async function listAdapters(): Promise<GpuAdapter[]> {
  if (process.platform !== 'win32') return [];
  try {
    const list = parseAdapterLines(await powershell(['-EncodedCommand', encoded(DXGI_SCRIPT)]));
    if (list.length) return list;
  } catch {
    // DXGI couldn't be asked; Windows' device list below has the same adapters.
  }
  // Fallback: Win32_VideoController (its order is not DXGI's).
  const out = await powershell([
    '-Command',
    'Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq "OK" } | ForEach-Object { $id = if ($_.PNPDeviceID -match "DEV_([0-9A-F]{4})") { $Matches[1] } else { "" }; "$($_.Name)`t$id" }',
  ]);
  return parseAdapterLines(out);
}

/** As Firefox's ANGLE names the adapter: "<name> (0x0000XXXX)", or the bare name. */
export function angleName(a: GpuAdapter): string {
  return a.deviceId ? `${a.name} (0x${a.deviceId.padStart(8, '0')})` : a.name;
}

/** The adapter's Windows name from what a profile saved (with or without the id). */
export function plainName(hostAdapter: string): string {
  return hostAdapter.replace(/ \(0x[0-9A-Fa-f]{8}\)$/, '');
}

/**
 * The adapter a new profile takes: the one programs get by default, or with `override`
 * (ENCLAVE_GPU) the first whose name contains it. null when there is none.
 */
export function chooseNewAdapter(adapters: GpuAdapter[], override?: string): GpuAdapter | null {
  if (override) {
    return adapters.find((a) => a.name.toLowerCase().includes(override.toLowerCase())) ?? null;
  }
  return adapters[0] ?? null;
}

/** The adapter a profile was made on, if this PC has it (wherever Windows lists it). */
export function findMadeOn(adapters: GpuAdapter[], hostAdapter: string): GpuAdapter | null {
  const name = plainName(hostAdapter);
  return (
    adapters.find((a) => angleName(a) === hostAdapter) ??
    adapters.find((a) => a.name === name) ??
    null
  );
}

/**
 * Each adapter's driver version, keyed by Windows adapter name. A saved "this card draws"
 * is kept per driver version, so a driver update (or rollback) makes Enclave draw-test the
 * card once more instead of trusting an old result. Empty off Windows or when the query fails.
 */
export async function driverVersions(): Promise<Map<string, string>> {
  if (process.platform !== 'win32') return new Map();
  const map = new Map<string, string>();
  try {
    const out = await powershell([
      '-Command',
      'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)`t$($_.DriverVersion)" }',
    ]);
    for (const line of out.split(/\r?\n/)) {
      const [name, version] = line.split('\t');
      if (name?.trim() && version?.trim()) map.set(name.trim(), version.trim());
    }
  } catch {
    // Driver versions couldn't be read; the draw test just runs without this hint.
  }
  return map;
}

/** Container settings that give a profile the GPU (WSL's /dev/dxg and its D3D12 libraries). */
export function gpuContainerSettings(adapter: string) {
  return {
    env: [
      'SESSION_ACCEL=1',
      'LD_LIBRARY_PATH=/usr/lib/wsl/lib',
      'GALLIUM_DRIVER=d3d12',
      `MESA_D3D12_DEFAULT_ADAPTER_NAME=${plainName(adapter)}`,
    ],
    devices: [{ PathOnHost: '/dev/dxg', PathInContainer: '/dev/dxg', CgroupPermissions: 'rwm' }],
    mounts: [
      { Type: 'bind' as const, Source: '/usr/lib/wsl', Target: '/usr/lib/wsl', ReadOnly: true },
    ],
  };
}

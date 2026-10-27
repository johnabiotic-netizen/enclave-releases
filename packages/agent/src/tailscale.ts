// Phone access over Tailscale (Stage 2, docs/setup/tailscale.md). Streams stay bound to
// 127.0.0.1; `tailscale serve` on Windows relays them to the tailnet only. That works the
// same with Docker Desktop and with Docker Engine in WSL, whose ports reach Windows on
// 127.0.0.1 alone. See DECISIONS.md.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const WINDOWS_CLI = 'C:\\Program Files\\Tailscale\\tailscale.exe';

export interface TailnetAddress {
  /** MagicDNS name, e.g. desktop-abc.tail1234.ts.net (HTTPS certificates are issued for it). */
  host: string;
  /** The PC's Tailscale IPv4, which WebRTC advertises to the phone. */
  ip: string;
}

export class Tailscale {
  private readonly cli: string;

  constructor(cli?: string) {
    this.cli =
      cli ?? (process.platform === 'win32' && existsSync(WINDOWS_CLI) ? WINDOWS_CLI : 'tailscale');
  }

  private async exec(args: string[]): Promise<string> {
    const { stdout } = await run(this.cli, args, { windowsHide: true, timeout: 60_000 });
    return stdout;
  }

  /** This PC on the tailnet, or null when Tailscale is missing, logged out or without HTTPS. */
  async address(): Promise<TailnetAddress | null> {
    try {
      const status = JSON.parse(await this.exec(['status', '--json'])) as {
        BackendState?: string;
        CertDomains?: string[] | null;
        Self?: { DNSName?: string; TailscaleIPs?: string[] };
      };
      const host = status.Self?.DNSName?.replace(/\.$/, '');
      const ip = status.Self?.TailscaleIPs?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      if (status.BackendState !== 'Running' || !host || !ip) return null;
      if (!status.CertDomains?.includes(host)) return null;
      return { host, ip };
    } catch {
      return null;
    }
  }

  /** https://<host>:<port> on the tailnet, relayed to http://127.0.0.1:<port>. */
  async serveHttps(port: number): Promise<void> {
    await this.exec(['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]);
  }

  /** Raw TCP <tailnet>:<port> relayed to 127.0.0.1:<port> (the WebRTC mux port). */
  async serveTcp(port: number): Promise<void> {
    await this.exec(['serve', '--bg', `--tcp=${port}`, `tcp://127.0.0.1:${port}`]);
  }

  async stopHttps(port: number): Promise<void> {
    await this.exec(['serve', `--https=${port}`, 'off']).catch(() => {});
  }

  async stopTcp(port: number): Promise<void> {
    await this.exec(['serve', `--tcp=${port}`, 'off']).catch(() => {});
  }
}

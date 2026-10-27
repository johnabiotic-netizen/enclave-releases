// Wires the agent together. The CLI's `serve` uses this; the desktop app (Stage 5) will too.

import { spawn, type ChildProcess } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { AgentConfig } from './config.js';
import { connectDocker, type DockerConnection } from './docker/connect.js';
import { DockerRuntime } from './docker/runtime.js';
import { phoneAppOrigin, ProfileService } from './profiles.js';
import { Tailscale } from './tailscale.js';
import { buildServer, listen } from './server.js';
import { ProfileStore } from './store.js';

export interface RunningAgent {
  service: ProfileService;
  app: FastifyInstance;
  dockerMode: string;
  /** Phone mode: where the phone app is, or undefined when phone mode is off or Tailscale is down. */
  phoneApp: string | undefined;
  close(): Promise<void>;
}

export async function startAgent(config: AgentConfig): Promise<RunningAgent> {
  const connection: DockerConnection = await connectDocker({
    dockerHost: config.dockerHost,
    wslDistro: config.wslDistro,
  });
  // WSL shuts its VM down when nothing on Windows uses it, and every profile with it. Hold
  // it open for as long as the agent runs.
  const keepAlive = connection.mode.startsWith('wsl:')
    ? keepWslRunning(config.wslDistro!)
    : undefined;

  const runtime = new DockerRuntime(connection.docker, config.image);
  const phone = config.phone === 'tailscale' ? new Tailscale() : undefined;
  const service = new ProfileService(config, new ProfileStore(config.home), runtime, phone);
  await service.startMonitor();
  const app = buildServer(config.token, service, runtime, config.mobileDir);
  await listen(app, config.port);

  // Phone mode: the agent itself (API and phone app) is relayed to the tailnet over HTTPS.
  let phoneApp: string | undefined;
  const tailnet = phone ? await phone.address() : null;
  if (phone && tailnet) {
    await phone.serveHttps(config.port);
    phoneApp = phoneAppOrigin(tailnet, config.port);
  }

  return {
    service,
    app,
    dockerMode: connection.mode,
    phoneApp,
    close: async () => {
      if (phone && phoneApp) await phone.stopHttps(config.port);
      service.stopMonitor();
      await app.close();
      await connection.close();
      keepAlive?.kill();
    },
  };
}

function keepWslRunning(distro: string): ChildProcess {
  const child = spawn('wsl.exe', ['-d', distro, '--', 'sleep', 'infinity'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  return child;
}

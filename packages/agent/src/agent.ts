// Wires the agent together. The CLI's `serve` uses this; the desktop app (Stage 5) will too.

import { spawn, type ChildProcess } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { AgentConfig } from './config.js';
import { connectDocker, type DockerConnection } from './docker/connect.js';
import { DockerRuntime } from './docker/runtime.js';
import { ProfileService } from './profiles.js';
import { buildServer, listen } from './server.js';
import { ProfileStore } from './store.js';

export interface RunningAgent {
  service: ProfileService;
  app: FastifyInstance;
  dockerMode: string;
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
  const service = new ProfileService(config, new ProfileStore(config.home), runtime);
  await service.startMonitor();
  const app = buildServer(config.token, service, runtime);
  await listen(app, config.port);

  return {
    service,
    app,
    dockerMode: connection.mode,
    close: async () => {
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

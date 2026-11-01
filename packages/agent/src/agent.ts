// Wires the agent together. The CLI's `serve` uses this; the desktop app (Stage 5) will too.

import { spawn, type ChildProcess } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { AgentConfig } from './config.js';
import { connectDocker, type DockerConnection } from './docker/connect.js';
import { DockerRuntime } from './docker/runtime.js';
import { phoneAppOrigin, ProfileService } from './profiles.js';
import { Tailscale } from './tailscale.js';
import { ImageDownloader } from './image-download.js';
import { RelayLink } from './relay/link.js';
import { AGENT_VERSION, buildServer, listen } from './server.js';
import { ProfileStore, type SecretSealer } from './store.js';

export interface RunningAgent {
  service: ProfileService;
  app: FastifyInstance;
  dockerMode: string;
  /** Phone mode: where the phone app is, or undefined when phone mode is off or Tailscale is down. */
  phoneApp: string | undefined;
  /** Phone linking through the relay (Stage 6); connected only in relay phone mode. */
  relay: RelayLink;
  close(): Promise<void>;
}

export interface AgentOptions {
  /** Encrypts profile secrets on disk (the Windows app: safeStorage). Without it they are plain. */
  sealer?: SecretSealer;
}

export async function startAgent(
  config: AgentConfig,
  options: AgentOptions = {},
): Promise<RunningAgent> {
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
  const store = new ProfileStore(config.home, options.sealer);
  await store.sealAll();
  // The relay link answers phones with the agent's own API, so it is made before the server
  // and reaches it once it exists.
  const server: { app?: FastifyInstance } = {};
  const relay: RelayLink = new RelayLink(
    config.home,
    {
      inject: async (req) => {
        const res = await server.app!.inject({
          method: req.method as 'GET',
          url: req.url,
          headers: {
            authorization: `Bearer ${config.token}`,
            ...(req.contentType ? { 'content-type': req.contentType } : {}),
          },
          ...(req.body ? { payload: req.body } : {}),
        });
        return {
          status: res.statusCode,
          contentType: String(res.headers['content-type'] ?? 'application/json'),
          body: res.rawPayload,
        };
      },
      streamPort: (id: string): Promise<number> => service.streamPort(id),
    },
    AGENT_VERSION,
    options.sealer,
  );
  const service: ProfileService = new ProfileService(config, store, runtime, phone, () =>
    relay.turn(),
  );
  await service.startMonitor();
  const app = buildServer(
    config.token,
    service,
    runtime,
    config.mobileDir,
    relay,
    new ImageDownloader(runtime),
  );
  server.app = app;
  await listen(app, config.port);
  await relay.start(config.phone === 'relay');

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
    relay,
    close: async () => {
      relay.stop();
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

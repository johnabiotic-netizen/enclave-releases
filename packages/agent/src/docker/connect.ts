// How the agent reaches Docker on Windows.
//
// Docker Desktop: its named pipe, //./pipe/docker_engine.
// Docker Engine inside a WSL distro (the owner's PC, see progress/DECISIONS.md): Windows has
// no pipe. The agent opens a private named pipe of its own and, for every connection on it,
// runs `wsl.exe -d <distro> -u root -- docker system dial-stdio`, which connects that
// process's stdin/stdout to the daemon. Nothing listens on a TCP port, and the distro stays
// running while a connection is open.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import Docker from 'dockerode';

const DESKTOP_PIPE = '//./pipe/docker_engine';

export interface DockerConnectOptions {
  /** `DOCKER_HOST` if set: passed to dockerode as is. */
  dockerHost?: string | undefined;
  /** WSL distro running Docker Engine. Used when Docker Desktop's pipe is absent. */
  wslDistro?: string | undefined;
}

export interface DockerConnection {
  docker: Docker;
  /** `desktop`, `wsl:<distro>`, or `env` (DOCKER_HOST). */
  mode: string;
  close(): Promise<void>;
}

export async function connectDocker(opts: DockerConnectOptions): Promise<DockerConnection> {
  if (opts.dockerHost) {
    return { docker: new Docker(), mode: 'env', close: async () => {} };
  }
  if (process.platform !== 'win32') {
    return { docker: new Docker(), mode: 'local', close: async () => {} };
  }
  if (existsSync(DESKTOP_PIPE) || !opts.wslDistro) {
    return {
      docker: new Docker({ socketPath: DESKTOP_PIPE }),
      mode: 'desktop',
      close: async () => {},
    };
  }
  const bridge = await startWslBridge(opts.wslDistro);
  return {
    docker: new Docker({ socketPath: bridge.pipe }),
    mode: `wsl:${opts.wslDistro}`,
    close: bridge.close,
  };
}

interface WslBridge {
  pipe: string;
  close(): Promise<void>;
}

async function startWslBridge(distro: string): Promise<WslBridge> {
  const pipe = `\\\\.\\pipe\\enclave-docker-${process.pid}-${randomBytes(8).toString('hex')}`;
  const children = new Set<ChildProcess>();

  const server = net.createServer((socket) => {
    const child = spawn(
      'wsl.exe',
      ['-d', distro, '-u', 'root', '--', 'docker', 'system', 'dial-stdio'],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    children.add(child);
    socket.pipe(child.stdin!);
    child.stdout!.pipe(socket);
    const end = () => {
      children.delete(child);
      socket.destroy();
      if (child.exitCode === null) child.kill();
    };
    child.on('exit', end);
    child.on('error', end);
    socket.on('close', end);
    socket.on('error', end);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => resolve());
  });
  // Pipes created here are only meant for this process; don't keep the event loop alive for them.
  server.unref();

  return {
    pipe,
    close: () =>
      new Promise<void>((resolve) => {
        for (const child of children) child.kill();
        server.close(() => resolve());
      }),
  };
}

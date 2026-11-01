// How the agent reaches Docker on Windows.
//
// Docker Desktop: its named pipe, //./pipe/docker_engine.
// Docker Engine inside a WSL distro (the owner's PC, and Enclave's own system from
// images/wsl, see progress/DECISIONS.md): Windows has no pipe. The agent opens a private named
// pipe of its own and, for every connection on it, runs a command in the distro that connects
// its stdin/stdout to the daemon: `docker system dial-stdio` where the docker tool is
// installed, else socat to the daemon's socket (Enclave's system ships no docker tool).
// Nothing listens on a TCP port, and the distro stays running while a connection is open.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import Docker from 'dockerode';

const DESKTOP_PIPE = '//./pipe/docker_engine';
const DIAL =
  'if command -v docker >/dev/null 2>&1; then exec docker system dial-stdio; ' +
  'else exec socat - UNIX-CONNECT:/var/run/docker.sock; fi';

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
      ['-d', distro, '-u', 'root', '-e', 'sh', '-c', DIAL],
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

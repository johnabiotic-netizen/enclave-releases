// Docker operations the agent needs, on top of dockerode.

import type Docker from 'dockerode';
import { AgentError } from '../errors.js';
import { demuxLogs, makeTar, type TarEntry } from './tar.js';

/** Label on every container, network and volume the agent creates. */
export const PROFILE_LABEL = 'enclave.profile';

export interface OneOffOptions {
  cmd: string[];
  /** Files written into the container before it starts (e.g. a secret the command reads). */
  files?: TarEntry[];
  /** `none` for no network at all. Default: Docker's default bridge. */
  networkMode?: string;
  timeoutMs?: number;
}

export class DockerRuntime {
  constructor(
    readonly docker: Docker,
    readonly image: string,
  ) {}

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async imageExists(): Promise<boolean> {
    try {
      await this.docker.getImage(this.image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /** Throws the right API error if Docker is down or the image is missing. */
  async assertReady(): Promise<void> {
    if (!(await this.ping())) {
      throw new AgentError(
        'DOCKER_DOWN',
        "Docker isn't running. Start Docker (or WSL) and try again.",
      );
    }
    if (!(await this.imageExists())) {
      throw new AgentError(
        'IMAGE_NOT_BUILT',
        `The browser image ${this.image} isn't built yet. Run .\\scripts\\build-image.ps1 first.`,
      );
    }
  }

  /** Runs the image once with `cmd` and returns its stdout. The container is always removed. */
  async runOneOff(opts: OneOffOptions): Promise<string> {
    const container = await this.docker.createContainer({
      Image: this.image,
      Cmd: opts.cmd,
      Labels: { [PROFILE_LABEL]: 'one-off' },
      HostConfig: {
        NetworkMode: opts.networkMode ?? 'bridge',
        // Lets a test proxy on the Docker host be reached the same way as from profiles.
        ExtraHosts: ['host.docker.internal:host-gateway'],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    try {
      if (opts.files?.length) await container.putArchive(makeTar(opts.files), { path: '/' });
      await container.start();
      const result = (await withTimeout(container.wait(), opts.timeoutMs ?? 120_000)) as {
        StatusCode: number;
      };
      const logs = demuxLogs(
        (await container.logs({ stdout: true, stderr: true })) as unknown as Buffer,
      );
      if (result.StatusCode !== 0) {
        throw new Error(
          `${opts.cmd[0]} exited with ${result.StatusCode}: ${logs.stderr.trim().slice(-500)}`,
        );
      }
      return logs.stdout;
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  async ensureNetwork(name: string, profileId: string): Promise<void> {
    const existing = await this.docker.listNetworks({ filters: { name: [name] } });
    if (existing.some((n) => n.Name === name)) return;
    await this.docker.createNetwork({
      Name: name,
      Driver: 'bridge',
      Labels: { [PROFILE_LABEL]: profileId },
    });
  }

  async removeNetwork(name: string): Promise<void> {
    await this.docker
      .getNetwork(name)
      .remove()
      .catch(() => {});
  }

  async ensureVolume(name: string, profileId: string): Promise<void> {
    try {
      await this.docker.getVolume(name).inspect();
    } catch {
      await this.docker.createVolume({ Name: name, Labels: { [PROFILE_LABEL]: profileId } });
    }
  }

  async removeVolume(name: string): Promise<void> {
    await this.docker
      .getVolume(name)
      .remove()
      .catch(() => {});
  }

  /** Inspect a container by name, or null if it doesn't exist. */
  async inspect(name: string): Promise<Docker.ContainerInspectInfo | null> {
    try {
      return await this.docker.getContainer(name).inspect();
    } catch {
      return null;
    }
  }

  /** Graceful stop (Firefox saves its session), then remove. The data volume stays. */
  async stopAndRemove(name: string, graceSeconds = 15): Promise<void> {
    const container = this.docker.getContainer(name);
    await container.stop({ t: graceSeconds }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  }

  /** Host ports published by any container the agent manages. */
  async usedHostPorts(): Promise<Set<number>> {
    const used = new Set<number>();
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [PROFILE_LABEL] },
    });
    for (const c of containers) for (const p of c.Ports) if (p.PublicPort) used.add(p.PublicPort);
    return used;
  }

  async logsTail(name: string, lines: number): Promise<string> {
    try {
      const buf = (await this.docker
        .getContainer(name)
        .logs({ stdout: true, stderr: true, tail: lines })) as unknown as Buffer;
      const { stdout, stderr } = demuxLogs(buf);
      return `${stdout}${stderr}`;
    } catch {
      return '';
    }
  }

  async exec(name: string, cmd: string[], user: string): Promise<number> {
    const exec = await this.docker
      .getContainer(name)
      .exec({ Cmd: cmd, User: user, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    stream.resume();
    await new Promise<void>((resolve) => stream.on('end', () => resolve()));
    return (await exec.inspect()).ExitCode ?? -1;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${Math.round(ms / 1000)} s`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

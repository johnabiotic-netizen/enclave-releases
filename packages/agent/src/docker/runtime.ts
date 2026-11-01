// Docker operations the agent needs, on top of dockerode.

import type Docker from 'dockerode';
import { AgentError } from '../errors.js';
import { demuxLogs, makeTar, readTarFile, type TarEntry } from './tar.js';

/** Label on every container, network and volume the agent creates. */
export const PROFILE_LABEL = 'enclave.profile';

export interface OneOffOptions {
  cmd: string[];
  /** Files written into the container before it starts (e.g. a secret the command reads). */
  files?: TarEntry[];
  /** `none` for no network at all. Default: Docker's default bridge. */
  networkMode?: string;
  devices?: Docker.DeviceMapping[];
  mounts?: Docker.MountSettings[];
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
        ...(opts.devices ? { Devices: opts.devices } : {}),
        ...(opts.mounts ? { Mounts: opts.mounts } : {}),
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

  /**
   * Inspect a container by name, or null if it doesn't exist. Other failures (Docker not
   * answering for a moment) throw: they say nothing about the container, and taking them for
   * "gone" marked running profiles as crashed.
   */
  async inspect(name: string): Promise<Docker.ContainerInspectInfo | null> {
    try {
      return await this.docker.getContainer(name).inspect();
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null;
      throw e;
    }
  }

  /**
   * Memory a container uses now, as `docker stats` shows it (usage less the page cache), or
   * null if it is not running.
   */
  async memoryBytes(name: string): Promise<number | null> {
    try {
      const s = (await this.docker.getContainer(name).stats({ stream: false })) as unknown as {
        memory_stats?: { usage?: number; stats?: { inactive_file?: number } };
      };
      const usage = s.memory_stats?.usage;
      if (usage === undefined) return null;
      return Math.max(0, usage - (s.memory_stats?.stats?.inactive_file ?? 0));
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

  /** Unpacks a tar (makeTar) at / in a running container. */
  async putArchive(name: string, tar: Buffer): Promise<void> {
    await this.docker.getContainer(name).putArchive(tar, { path: '/' });
  }

  /**
   * Downloads the browser image (a registry reference, pinned by digest). `onProgress` gets
   * each of Docker's progress events.
   */
  async pullImage(onProgress: (event: PullEvent) => void): Promise<void> {
    const stream = (await this.docker.pull(this.image)) as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => (err ? reject(err) : resolve()),
        (event: PullEvent) => onProgress(event),
      );
    });
    if (!(await this.imageExists())) throw new Error('The download finished without the image.');
  }

  /** One regular file from a container (docker cp), refused when larger than `maxBytes`. */
  async getFile(name: string, path: string, maxBytes: number): Promise<Buffer> {
    const stream = (await this.docker
      .getContainer(name)
      .getArchive({ path })) as unknown as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += (chunk as Buffer).length;
      if (size > maxBytes + 4096) throw new Error('file too large');
      chunks.push(chunk as Buffer);
    }
    return readTarFile(Buffer.concat(chunks));
  }

  /** Runs `cmd` in a running container and returns its stdout and exit code. */
  async execOutput(
    name: string,
    cmd: string[],
    user: string,
  ): Promise<{ code: number; stdout: string }> {
    const exec = await this.docker
      .getContainer(name)
      .exec({ Cmd: cmd, User: user, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    await new Promise<void>((resolve) => stream.on('end', () => resolve()));
    const { stdout } = demuxLogs(Buffer.concat(chunks));
    return { code: await exitCode(exec), stdout };
  }

  async exec(name: string, cmd: string[], user: string): Promise<number> {
    const exec = await this.docker
      .getContainer(name)
      .exec({ Cmd: cmd, User: user, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    stream.resume();
    await new Promise<void>((resolve) => stream.on('end', () => resolve()));
    return exitCode(exec);
  }
}

/** An exec's exit code. Docker can still report it running (code null) just after its
 * output ends, so ask again briefly; -1 if it never settles. */
async function exitCode(exec: Docker.Exec): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const info = await exec.inspect();
    if (!info.Running && info.ExitCode !== null) return info.ExitCode;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return -1;
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

/** One line of Docker's pull progress. */
export interface PullEvent {
  id?: string;
  status?: string;
  progressDetail?: { current?: number; total?: number };
  error?: string;
}

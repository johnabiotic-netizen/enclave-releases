// Profile lifecycle: create (safety check + fingerprint), start, stop, delete, idle stop.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_IDLE_STOP_MINUTES,
  type CreateProfileRequest,
  type Fingerprint,
  type Profile,
  type ProfileStatus,
  type ProxyCheckResult,
  type ProxyInput,
  type StreamInfo,
  type SystemResponse,
  type UpdateProfileRequest,
} from '@enclave/shared';
import type { AgentConfig } from './config.js';
import { PROFILE_LABEL, type DockerRuntime } from './docker/runtime.js';
import { makeTar, type TarEntry } from './docker/tar.js';
import { detectGpu, gpuContainerSettings } from './gpu.js';
import type { TailnetAddress, Tailscale } from './tailscale.js';
import { evaluateAudit, summarize, type Finding, type Reference } from './audit-readers.js';
import { AgentError, InputError } from './errors.js';
import { nekoLogin, nekoReachable, nekoSessions } from './neko.js';
import { describeProxy, judgeProxyCheck, parseProxy, type RawProxyCheck } from './proxy.js';
import { PROXY_SECRET_REF, type ProfileSecrets, type ProfileStore } from './store.js';

/** Host ports for streams: web client/API and the WebRTC mux, in pairs. Bound to 127.0.0.1. */
const PORT_RANGE = { first: 52100, last: 52998 };
const START_TIMEOUT_MS = 120_000;
const MONITOR_INTERVAL_MS = 60_000;
/** The stream password lives as long as the container; this is a nominal upper bound. */
const STREAM_TTL_MS = 24 * 60 * 60 * 1000;
const CONTAINER_MEMORY_BYTES = 3 * 1024 ** 3;
const SHM_BYTES = 2 * 1024 ** 3;
const PROXY_UNREACHABLE = 'Proxy unreachable';

const containerName = (id: string) => `enclave-${id}`;
const networkName = (id: string) => `enclave-${id}`;
const volumeName = (id: string) => `enclave-${id}-data`;
const randomPassword = () => randomBytes(18).toString('base64url');
const auditContainerName = (id: string) => `enclave-audit-${id}`;
/** Marks audit containers (testing/test-suite.md); not PROFILE_LABEL, so nothing mistakes one for the profile. */
const AUDIT_LABEL = 'enclave.audit';
/** The longest an audit run may take: every check's own timeout plus start-up. */
const AUDIT_TIMEOUT_MS = 20 * 60_000;
const AUDIT_POLL_MS = 5_000;

export class ProfileService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastViewerAt = new Map<string, number>();
  private readonly nekoTokens = new Map<string, string>();
  /** Audit runs started through the API, kept until the agent restarts. */
  private readonly auditJobs = new Map<string, AuditJob>();
  private monitor: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: AgentConfig,
    private readonly store: ProfileStore,
    private readonly runtime: DockerRuntime,
    /** Phone mode (ENCLAVE_PHONE=tailscale): relays streams to the tailnet. */
    private readonly phone?: Tailscale,
  ) {}

  // ---------------------------------------------------------------- queries

  list(): Promise<Profile[]> {
    return this.store.list();
  }

  get(id: string): Promise<Profile> {
    return this.store.get(id);
  }

  async stream(id: string): Promise<StreamInfo> {
    const profile = await this.store.get(id);
    const secrets = await this.store.getSecrets(id);
    if (profile.status.state !== 'running' || !profile.status.streamPort || !secrets.stream) {
      throw new AgentError(
        'PROFILE_NOT_RUNNING',
        `"${profile.name}" isn't running. Start it first.`,
      );
    }
    return streamInfo(profile.status.streamPort, secrets.stream);
  }

  logs(id: string, tail: number): Promise<string[]> {
    return this.store.get(id).then(() => this.store.tailLog(id, tail));
  }

  async system(): Promise<SystemResponse> {
    const dockerOk = await this.runtime.ping();
    const profiles = await this.store.list();
    return {
      ram: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      profilesRunning: profiles.filter((p) => p.status.state === 'running').length,
      dockerOk,
      virtualizationOk: dockerOk,
      imageBuilt: dockerOk && (await this.runtime.imageExists()),
    };
  }

  // ---------------------------------------------------------------- create / update / delete

  async create(req: CreateProfileRequest): Promise<Profile> {
    const name = validName(req.name);
    const useTestProxy = req.useTestProxy === true;
    let proxy: ProxyInput;
    if (useTestProxy) {
      if (!this.config.testProxy) throw new InputError('TEST_PROXY is not set in .env.');
      proxy = parseProxy(this.config.testProxy);
    } else {
      if (!req.proxy) throw new InputError('A proxy is required (or use the test proxy).');
      proxy = parseProxy(req.proxy);
    }

    await this.runtime.assertReady();
    const adapter = await this.requireGpu();
    const raw = await this.checkProxy(proxy, useTestProxy);
    const fingerprint = await this.generateFingerprint(raw, adapter);

    const now = new Date().toISOString();
    const id = this.store.newId();
    const profile: Profile = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      ...(useTestProxy ? { notes: 'Test proxy, not for real accounts.' } : {}),
      proxy: {
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        ...(proxy.username ? { username: proxy.username } : {}),
        ...(proxy.password ? { secretRef: PROXY_SECRET_REF } : {}),
        lastCheck: checkResult(raw, true),
      },
      fingerprint,
      runtime: {
        idleStopMinutes: DEFAULT_IDLE_STOP_MINUTES,
        ...(useTestProxy ? { usesTestProxy: true } : {}),
      },
      status: {
        state: 'stopped',
        containerId: null,
        streamPort: null,
        lastError: null,
        lastStartedAt: null,
      },
    };
    await this.store.saveSecrets(id, proxy.password ? { proxyPassword: proxy.password } : {});
    await this.store.save(profile);
    await this.store.log(id, 'created', {
      name,
      proxy: describeProxy(proxy),
      exitIp: raw.exitIp,
      country: raw.country,
      timezone: raw.timezone,
      userAgent: fingerprint.userAgent,
    });
    return profile;
  }

  async update(id: string, req: UpdateProfileRequest): Promise<Profile> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      if (req.name !== undefined) profile.name = validName(req.name);
      if (req.notes !== undefined) profile.notes = String(req.notes).slice(0, 2000);
      if (req.idleStopMinutes !== undefined) {
        const minutes = Number(req.idleStopMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          throw new InputError('idleStopMinutes must be a whole number from 1 to 1440.');
        }
        profile.runtime.idleStopMinutes = minutes;
      }
      if (req.proxy !== undefined) {
        if (profile.status.state === 'running') {
          throw new AgentError('PROFILE_RUNNING', 'Stop the profile before changing its proxy.');
        }
        const proxy = parseProxy(req.proxy);
        await this.runtime.assertReady();
        const raw = await this.checkProxy(proxy, false);
        assertLocationMatches(profile.fingerprint, raw);
        moveGeolocation(profile.fingerprint, raw);
        profile.proxy = {
          type: proxy.type,
          host: proxy.host,
          port: proxy.port,
          ...(proxy.username ? { username: proxy.username } : {}),
          ...(proxy.password ? { secretRef: PROXY_SECRET_REF } : {}),
          lastCheck: checkResult(raw, true),
        };
        delete profile.runtime.usesTestProxy;
        const secrets = await this.store.getSecrets(id);
        if (proxy.password) secrets.proxyPassword = proxy.password;
        else delete secrets.proxyPassword;
        await this.store.saveSecrets(id, secrets);
        await this.store.log(id, 'proxy-changed', {
          proxy: describeProxy(proxy),
          exitIp: raw.exitIp,
        });
      }
      profile.updatedAt = new Date().toISOString();
      await this.store.save(profile);
      return profile;
    });
  }

  async delete(id: string, confirm: boolean): Promise<void> {
    if (!confirm)
      throw new InputError(
        "Deleting removes all of this profile's data. Send confirm=true to go ahead.",
      );
    await this.exclusive(id, async () => {
      await this.store.get(id);
      await this.runtime.stopAndRemove(containerName(id));
      await this.runtime.removeNetwork(networkName(id));
      await this.runtime.removeVolume(volumeName(id));
      await this.store.remove(id);
      this.forget(id);
    });
  }

  async checkProfileProxy(id: string): Promise<ProxyCheckResult> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      await this.runtime.assertReady();
      const proxy = proxyInput(profile, await this.store.getSecrets(id));
      const raw = await this.runProxyCheck(proxy);
      const verdict = judgeProxyCheck(raw, profile.runtime.usesTestProxy === true);
      profile.proxy.lastCheck = checkResult(raw, verdict.ok);
      await this.store.save(profile);
      await this.store.log(id, 'proxy-checked', {
        ok: verdict.ok,
        exitIp: raw.exitIp,
        country: raw.country,
      });
      return profile.proxy.lastCheck;
    });
  }

  // ---------------------------------------------------------------- audit

  /**
   * Runs check pages in a throwaway copy of the profile (testing/test-suite.md): the
   * same image, fingerprint and proxy, an in-memory /data, no published ports. The real
   * profile is never driven by automation and may be running meanwhile. Saves the
   * result and screenshots under <home>/reports/ and returns them.
   */
  async audit(id: string, checks: string[]): Promise<AuditRun> {
    const profile = await this.store.get(id);
    await this.runtime.assertReady();
    const secrets = await this.store.getSecrets(id);
    const proxy = proxyInput(profile, secrets);
    const raw = await this.checkProxy(proxy, profile.runtime.usesTestProxy === true);
    assertLocationMatches(profile.fingerprint, raw);
    const gpu = gpuContainerSettings(await this.requireSameGpu(profile.fingerprint));

    const name = auditContainerName(id);
    await this.runtime.stopAndRemove(name, 1).catch(() => {});
    await this.runtime.ensureNetwork(networkName(id), id);
    const startedAt = new Date();
    await this.store.log(id, 'audit-started', { checks });
    try {
      const container = await this.runtime.docker.createContainer({
        name,
        Image: this.runtime.image,
        Labels: { [AUDIT_LABEL]: id },
        Env: [
          'ENCLAVE_AUDIT=1',
          'NEKO_MEMBER_PROVIDER=multiuser',
          `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${randomPassword()}`,
          `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${randomPassword()}`,
          ...gpu.env,
          ...exitEnv(raw),
        ],
        HostConfig: {
          NetworkMode: networkName(id),
          // A fresh browser profile each run, gone with the container.
          Tmpfs: { '/data': 'size=2g' },
          Mounts: gpu.mounts,
          Devices: gpu.devices,
          CapAdd: ['NET_ADMIN'],
          SecurityOpt: ['no-new-privileges'],
          ShmSize: SHM_BYTES,
          Memory: CONTAINER_MEMORY_BYTES,
          ExtraHosts: ['host.docker.internal:host-gateway'],
        },
      });
      await container.putArchive(
        makeTar([
          ...configFiles(profile, proxy),
          { name: 'config/audit.json', mode: 0o644, content: JSON.stringify({ checks }) },
        ]),
        { path: '/' },
      );
      await container.start();

      const report = await this.waitForAuditResult(name);
      const dir = path.join(
        this.config.home,
        'reports',
        `${startedAt.toISOString().replace(/[:.]/g, '-')}-audit-${slug(profile.name)}`,
      );
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
      for (const check of report.checks ?? []) {
        if (!check.screenshot || !/^[\w.-]+\.png$/.test(check.screenshot)) continue;
        const shot = await this.runtime.execOutput(
          name,
          ['base64', '-w0', `/data/audit/${check.screenshot}`],
          'root',
        );
        if (shot.code === 0) {
          await writeFile(path.join(dir, check.screenshot), Buffer.from(shot.stdout, 'base64'));
        }
      }
      const findings = evaluateAudit(report, {
        exitIp: raw.exitIp ?? null,
        baseline: await readJson(
          path.join(this.config.home, 'profiles', id, 'baselines', 'baseline.json'),
        ),
        reference: await this.loadReference(),
      });
      const summary = summarize(profile.name, raw.exitIp ?? null, findings);
      await writeFile(path.join(dir, 'findings.json'), JSON.stringify(findings, null, 2));
      await writeFile(path.join(dir, 'summary.txt'), `${summary}\n`);
      await this.store.log(id, 'audit-finished', {
        reportDir: dir,
        fail: findings.filter((f) => f.verdict === 'fail').length,
      });
      return { reportDir: dir, exitIp: raw.exitIp ?? null, report, findings, summary };
    } finally {
      await this.runtime.stopAndRemove(name, 2).catch(() => {});
    }
  }

  /**
   * Starts an audit in the background; an audit takes minutes, longer than an HTTP
   * request should wait. Poll auditJob() for the outcome. One audit per profile at once.
   */
  startAudit(id: string, checks: string[]): AuditJob {
    const running = [...this.auditJobs.values()].find(
      (j) => j.profileId === id && j.state === 'running',
    );
    if (running) return running;
    const job: AuditJob = {
      id: randomBytes(8).toString('hex'),
      profileId: id,
      checks,
      state: 'running',
      startedAt: new Date().toISOString(),
    };
    this.auditJobs.set(job.id, job);
    this.audit(id, checks).then(
      (run) => Object.assign(job, { state: 'done', finishedAt: new Date().toISOString(), run }),
      (e: unknown) =>
        Object.assign(job, {
          state: 'failed',
          finishedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        }),
    );
    return job;
  }

  auditJob(jobId: string): AuditJob {
    const job = this.auditJobs.get(jobId);
    if (!job) throw new InputError('No such audit.');
    return job;
  }

  private async loadReference(): Promise<Reference> {
    const dir = this.config.referenceDir;
    return {
      probe: await readJson(path.join(dir, 'probe.json')),
      metrics: await readJson(path.join(dir, 'metrics.json')),
      svgEmojiCurrentFont: await readJson(path.join(dir, 'svg-emoji-current-font.json')),
      creepjs: await readJson(path.join(dir, 'creepjs.json')),
    };
  }

  private async waitForAuditResult(name: string): Promise<AuditReport> {
    const deadline = Date.now() + AUDIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await this.runtime.inspect(name);
      if (!info?.State.Running) {
        const logs = await this.runtime.logsTail(name, 20);
        throw new AgentError(
          'INTERNAL',
          `The audit container stopped early: ${logs.trim().slice(-500)}`,
        );
      }
      const out = await this.runtime
        .execOutput(name, ['cat', '/data/audit/result.json'], 'root')
        .catch(() => null);
      if (out?.code === 0 && out.stdout.trim()) return JSON.parse(out.stdout) as AuditReport;
      await new Promise((r) => setTimeout(r, AUDIT_POLL_MS));
    }
    throw new AgentError('INTERNAL', 'The audit took longer than 20 minutes and was stopped.');
  }

  // ---------------------------------------------------------------- start / stop

  async start(id: string): Promise<{ stream: StreamInfo }> {
    return this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      await this.runtime.assertReady();
      const name = containerName(id);
      const existing = await this.runtime.inspect(name);
      if (existing?.State.Running) {
        throw new AgentError('PROFILE_RUNNING', `"${profile.name}" is already running.`);
      }
      if (existing) await this.runtime.stopAndRemove(name);

      await this.setStatus(profile, { state: 'starting', lastError: null });
      await this.store.log(id, 'starting');
      let relayed: number | null = null;
      try {
        const secrets = await this.store.getSecrets(id);
        const proxy = proxyInput(profile, secrets);
        const raw = await this.checkProxy(proxy, profile.runtime.usesTestProxy === true);
        assertLocationMatches(profile.fingerprint, raw);
        profile.proxy.lastCheck = checkResult(raw, true);
        const gpu = gpuContainerSettings(await this.requireSameGpu(profile.fingerprint));

        const [webPort, muxPort] = await this.allocatePorts();
        // Phone mode: the stream is also relayed to the tailnet. Without Tailscale the
        // profile still starts for the PC; the phone link is simply missing.
        const tailnet = this.phone ? await this.phone.address() : null;
        if (this.phone && !tailnet) await this.store.log(id, 'phone-unavailable');
        const stream = {
          userPassword: randomPassword(),
          adminPassword: randomPassword(),
          expiresAt: new Date(Date.now() + STREAM_TTL_MS).toISOString(),
          ...(tailnet ? { phoneHost: tailnet.host } : {}),
        };
        await this.store.saveSecrets(id, { ...secrets, stream });

        await this.runtime.ensureNetwork(networkName(id), id);
        await this.runtime.ensureVolume(volumeName(id), id);
        const container = await this.runtime.docker.createContainer({
          name,
          Image: this.runtime.image,
          Labels: { [PROFILE_LABEL]: id },
          Env: [
            'NEKO_MEMBER_PROVIDER=multiuser',
            `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${stream.userPassword}`,
            `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${stream.adminPassword}`,
            `NEKO_WEBRTC_TCPMUX=${muxPort}`,
            `NEKO_WEBRTC_UDPMUX=${muxPort}`,
            'NEKO_WEBRTC_ICELITE=true',
            // The address WebRTC tells viewers to reach the mux port at. One only: with two,
            // pion keeps the first ("overlapping address rewrite rule"). In phone mode that is
            // the PC's Tailscale IP, which tailscale serve relays and the PC reaches too.
            `NEKO_WEBRTC_NAT1TO1=${tailnet ? tailnet.ip : '127.0.0.1'}`,
            // The phone app (served by the agent) talks to neko's API from its own origin.
            // With a CORS list neko checks every origin, the PC's own page included.
            ...(tailnet
              ? [
                  `NEKO_SERVER_CORS=${phoneAppOrigin(tailnet, this.config.port)} http://127.0.0.1:${webPort}`,
                ]
              : []),
            ...gpu.env,
            ...exitEnv(raw),
          ],
          ExposedPorts: { '8080/tcp': {}, [`${muxPort}/tcp`]: {}, [`${muxPort}/udp`]: {} },
          HostConfig: {
            NetworkMode: networkName(id),
            PortBindings: {
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(webPort) }],
              [`${muxPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(muxPort) }],
              [`${muxPort}/udp`]: [{ HostIp: '127.0.0.1', HostPort: String(muxPort) }],
            },
            Mounts: [{ Type: 'volume', Source: volumeName(id), Target: '/data' }, ...gpu.mounts],
            Devices: gpu.devices,
            // The egress lock needs NET_ADMIN once; the entrypoint drops it before the browser starts.
            CapAdd: ['NET_ADMIN'],
            SecurityOpt: ['no-new-privileges'],
            ShmSize: SHM_BYTES,
            Memory: CONTAINER_MEMORY_BYTES,
            ExtraHosts: ['host.docker.internal:host-gateway'],
          },
        });
        await container.putArchive(configArchive(profile, proxy), { path: '/' });
        await container.start();
        await this.waitUntilReady(name, webPort);
        if (tailnet && this.phone) {
          relayed = webPort;
          await this.phone.serveHttps(webPort);
          await this.phone.serveTcp(muxPort);
        }

        profile.status = {
          state: 'running',
          containerId: container.id,
          streamPort: webPort,
          lastError: null,
          lastStartedAt: new Date().toISOString(),
        };
        await this.store.save(profile);
        this.lastViewerAt.set(id, Date.now());
        this.nekoTokens.delete(id);
        await this.store.log(id, 'started', {
          webPort,
          muxPort,
          exitIp: raw.exitIp,
          phone: Boolean(tailnet),
        });
        return { stream: streamInfo(webPort, stream) };
      } catch (e) {
        await this.runtime.stopAndRemove(name, 5).catch(() => {});
        await this.stopRelays(relayed);
        const message = e instanceof Error ? e.message : String(e);
        const proxyProblem = e instanceof AgentError && e.code.startsWith('PROXY_');
        await this.setStatus(profile, {
          state: proxyProblem || e instanceof AgentError ? 'stopped' : 'error',
          containerId: null,
          streamPort: null,
          lastError: message,
        });
        await this.store.log(id, 'start-failed', {
          code: e instanceof AgentError ? e.code : 'INTERNAL',
          message,
        });
        throw e instanceof AgentError || e instanceof InputError
          ? e
          : new AgentError('INTERNAL', `"${profile.name}" didn't start: ${message}`);
      }
    });
  }

  async stop(id: string, reason: 'requested' | 'idle' = 'requested'): Promise<void> {
    await this.exclusive(id, async () => {
      const profile = await this.store.get(id);
      const info = await this.runtime.inspect(containerName(id));
      if (!info?.State.Running && profile.status.state !== 'running') {
        throw new AgentError('PROFILE_NOT_RUNNING', `"${profile.name}" isn't running.`);
      }
      await this.runtime.stopAndRemove(containerName(id));
      await this.runtime.removeNetwork(networkName(id));
      await this.stopRelays(profile.status.streamPort);
      const secrets = await this.store.getSecrets(id);
      delete secrets.stream;
      await this.store.saveSecrets(id, secrets);
      await this.setStatus(profile, {
        state: 'stopped',
        containerId: null,
        streamPort: null,
        lastError: null,
      });
      this.forget(id);
      await this.store.log(id, 'stopped', { reason });
    });
  }

  // ---------------------------------------------------------------- background work

  /** Brings stored status in line with Docker (after an agent or PC restart), then watches. */
  async startMonitor(): Promise<void> {
    if (await this.runtime.ping()) {
      for (const profile of await this.store.list()) {
        if (profile.status.state !== 'running' && profile.status.state !== 'starting') continue;
        const info = await this.runtime.inspect(containerName(profile.id));
        if (info?.State.Running && profile.status.state === 'running') {
          this.lastViewerAt.set(profile.id, Date.now());
        } else {
          await this.runtime.stopAndRemove(containerName(profile.id), 5);
          await this.stopRelays(profile.status.streamPort);
          await this.setStatus(profile, { state: 'stopped', containerId: null, streamPort: null });
          await this.store.log(profile.id, 'reconciled', { was: profile.status.state });
        }
      }
    }
    this.monitor = setInterval(() => void this.tick(), MONITOR_INTERVAL_MS);
    this.monitor.unref();
  }

  stopMonitor(): void {
    if (this.monitor) clearInterval(this.monitor);
  }

  private async tick(): Promise<void> {
    let profiles: Profile[];
    try {
      profiles = await this.store.list();
    } catch {
      return;
    }
    for (const profile of profiles.filter((p) => p.status.state === 'running')) {
      if (this.locks.has(profile.id)) continue;
      await this.watch(profile).catch(() => {});
    }
  }

  private async watch(profile: Profile): Promise<void> {
    const id = profile.id;
    const name = containerName(id);
    const info = await this.runtime.inspect(name);
    if (!info?.State.Running) {
      await this.setStatus(profile, {
        state: 'error',
        containerId: null,
        streamPort: null,
        lastError: 'The browser stopped unexpectedly.',
      });
      await this.stopRelays(profile.status.streamPort);
      await this.store.log(id, 'exited', { exitCode: info?.State.ExitCode ?? null });
      this.forget(id);
      return;
    }

    // Idle stop: nobody connected to the stream for idleStopMinutes.
    const viewers = await this.countViewers(profile);
    const now = Date.now();
    if (viewers === null || viewers > 0 || !this.lastViewerAt.has(id))
      this.lastViewerAt.set(id, now);
    const idleMinutes = profile.runtime.idleStopMinutes ?? DEFAULT_IDLE_STOP_MINUTES;
    if (now - this.lastViewerAt.get(id)! >= idleMinutes * 60_000) {
      await this.stop(id, 'idle');
      return;
    }

    // Proxy health, through the profile's own forwarder (the lock blocks everything else).
    const code = await this.runtime
      .exec(
        name,
        [
          'curl',
          '-s',
          '-o',
          '/dev/null',
          '-m',
          '15',
          '--socks5-hostname',
          '127.0.0.1:1080',
          'https://api.ipify.org',
        ],
        'neko',
      )
      .catch(() => -1);
    const healthy = code === 0;
    if (!healthy && profile.status.lastError !== PROXY_UNREACHABLE) {
      await this.setStatus(profile, { lastError: PROXY_UNREACHABLE });
      await this.store.log(id, 'proxy-unreachable');
    } else if (healthy && profile.status.lastError === PROXY_UNREACHABLE) {
      await this.setStatus(profile, { lastError: null });
      await this.store.log(id, 'proxy-back');
    }
  }

  /** Viewers connected to the stream, or null if neko couldn't be asked. */
  private async countViewers(profile: Profile): Promise<number | null> {
    const port = profile.status.streamPort;
    const secrets = await this.store.getSecrets(profile.id);
    if (!port || !secrets.stream) return null;
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let token = this.nekoTokens.get(profile.id);
        if (!token) {
          token = await nekoLogin(base, 'enclave-agent', secrets.stream.adminPassword);
          this.nekoTokens.set(profile.id, token);
        }
        const sessions = await nekoSessions(base, token);
        return sessions.filter((s) => s.state?.is_connected).length;
      } catch {
        this.nekoTokens.delete(profile.id);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- helpers

  /** Runs the safety check and throws the matching API error if it fails. */
  private async checkProxy(proxy: ProxyInput, allowRealIp: boolean): Promise<RawProxyCheck> {
    const raw = await this.runProxyCheck(proxy);
    const verdict = judgeProxyCheck(raw, allowRealIp);
    if (!verdict.ok) {
      throw new AgentError(verdict.code, verdict.message, {
        proxy: describeProxy(proxy),
        ...(raw.exitIp ? { exitIp: raw.exitIp } : {}),
      });
    }
    return raw;
  }

  private async runProxyCheck(proxy: ProxyInput): Promise<RawProxyCheck> {
    const out = await this.runtime.runOneOff({
      cmd: ['bash', '-c', '/opt/enclave/check_proxy.py < /run/check/proxy.json'],
      files: [
        { name: 'run/check/', mode: 0o700 },
        { name: 'run/check/proxy.json', mode: 0o600, content: JSON.stringify(proxy) },
      ],
      timeoutMs: 90_000,
    });
    return JSON.parse(out) as RawProxyCheck;
  }

  /**
   * The PC's GPU, which profiles render on and claim. Refuses when there is none, or when
   * Docker can't hand it to containers: a profile drawing in software would show output
   * no Windows PC produces.
   */
  private async requireGpu(): Promise<string> {
    const adapter = await detectGpu(this.config.gpu).catch(() => null);
    if (!adapter) {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        this.config.gpu
          ? `No graphics card matching "${this.config.gpu}" (ENCLAVE_GPU). Check the name in Device Manager.`
          : "This PC's graphics card couldn't be found. Profiles need it to draw like a real Windows PC.",
      );
    }
    const gpu = gpuContainerSettings(adapter);
    try {
      await this.runtime.runOneOff({
        cmd: ['test', '-c', '/dev/dxg'],
        networkMode: 'none',
        devices: gpu.devices,
        mounts: gpu.mounts,
        timeoutMs: 60_000,
      });
    } catch {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        `Docker can't give profiles the graphics card (${adapter}). Update Windows, WSL and the graphics driver, then try again.`,
      );
    }
    return adapter;
  }

  /** A profile claims the GPU it was made on; starting it on another would contradict that. */
  private async requireSameGpu(fingerprint: Fingerprint): Promise<string> {
    const madeOn = fingerprint.webgl?.hostAdapter;
    if (typeof madeOn !== 'string') {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        'This profile was made before profiles used the graphics card. Create a new profile.',
      );
    }
    const adapter = await this.requireGpu();
    if (adapter !== madeOn) {
      throw new AgentError(
        'GPU_UNAVAILABLE',
        `This profile was made on a PC with ${madeOn}, but this one has ${adapter}. It can't start here without changing its fingerprint.`,
        { madeOn, current: adapter },
      );
    }
    return adapter;
  }

  private async generateFingerprint(raw: RawProxyCheck, adapter: string): Promise<Fingerprint> {
    const out = await this.runtime.runOneOff({
      cmd: [
        '/opt/enclave/gen_fingerprint.py',
        '--gpu',
        adapter,
        '--country',
        raw.country!,
        '--timezone',
        raw.timezone!,
        '--locale',
        raw.locale ?? `en-${raw.country}`,
        '--ip',
        raw.exitIp!,
      ],
      networkMode: 'none',
      timeoutMs: 120_000,
    });
    return JSON.parse(out) as Fingerprint;
  }

  private async allocatePorts(): Promise<[number, number]> {
    const used = await this.runtime.usedHostPorts();
    for (const p of await this.store.list()) if (p.status.streamPort) used.add(p.status.streamPort);
    for (let web = PORT_RANGE.first; web < PORT_RANGE.last; web += 2) {
      const mux = web + 1;
      if (used.has(web) || used.has(mux)) continue;
      if ((await portFree(web)) && (await portFree(mux))) return [web, mux];
    }
    throw new AgentError(
      'INTERNAL',
      'No free stream ports left. Stop another profile and try again.',
    );
  }

  private async waitUntilReady(name: string, webPort: number): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await this.runtime.inspect(name);
      if (!info?.State.Running) {
        const tail = (await this.runtime.logsTail(name, 40))
          .split('\n')
          .filter((l) => l.includes('enclave:'))
          .join(' ');
        throw new Error(
          tail || `the browser stopped during startup (code ${info?.State.ExitCode ?? '?'})`,
        );
      }
      if (
        info.State.Health?.Status === 'healthy' &&
        (await nekoReachable(`http://127.0.0.1:${webPort}`))
      )
        return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`the browser wasn't ready after ${START_TIMEOUT_MS / 1000} s`);
  }

  /** Removes a profile's tailnet relays (web port, and the mux port right after it). */
  private async stopRelays(webPort: number | null): Promise<void> {
    if (!this.phone || !webPort) return;
    await this.phone.stopHttps(webPort);
    await this.phone.stopTcp(webPort + 1);
  }

  private async setStatus(profile: Profile, patch: Partial<ProfileStatus>): Promise<void> {
    profile.status = { ...profile.status, ...patch };
    await this.store.save(profile);
  }

  private forget(id: string): void {
    this.lastViewerAt.delete(id);
    this.nekoTokens.delete(id);
  }

  /** One state change at a time per profile. */
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }
}

function validName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text || text.length > 60)
    throw new InputError('The profile name must be 1 to 60 characters.');
  return text;
}

function proxyInput(profile: Profile, secrets: ProfileSecrets): ProxyInput {
  const { type, host, port, username } = profile.proxy;
  return {
    type,
    host,
    port,
    ...(username ? { username } : {}),
    ...(secrets.proxyPassword ? { password: secrets.proxyPassword } : {}),
  };
}

function checkResult(raw: RawProxyCheck, ok: boolean): ProxyCheckResult {
  return {
    at: new Date().toISOString(),
    ok,
    ...(raw.exitIp ? { exitIp: raw.exitIp } : {}),
    ...(raw.country ? { country: raw.country } : {}),
    ...(raw.timezone ? { timezone: raw.timezone } : {}),
    ...(raw.latencyMs !== undefined ? { latencyMs: raw.latencyMs } : {}),
  };
}

/** Hard rule 3: the proxy's location must still match the saved fingerprint. */
function assertLocationMatches(fingerprint: Fingerprint, raw: RawProxyCheck): void {
  const country = fingerprint.locale.split('-')[1]?.toUpperCase();
  if (raw.timezone === fingerprint.timezone && (!country || raw.country === country)) return;
  throw new AgentError(
    'PROXY_LOCATION_MISMATCH',
    `The proxy is now in ${raw.country} (${raw.timezone}), but this profile was made for ${country ?? '?'} (${fingerprint.timezone}). Not starting, to keep the profile consistent.`,
    {
      expected: { country, timezone: fingerprint.timezone },
      actual: { country: raw.country, timezone: raw.timezone, exitIp: raw.exitIp },
    },
  );
}

/**
 * The address WebRTC reports as the profile's public IP: the exit IP this start's check
 * just saw, not the one saved at creation, so it stays equal to the IP websites see
 * after a proxy change or a new sticky IP. Likewise the browser's location: where that
 * IP is now (same country and timezone, checked before), in case a sticky IP was renewed
 * elsewhere.
 */
function exitEnv(raw: RawProxyCheck): string[] {
  return [
    ...(raw.exitIp ? [`ENCLAVE_EXIT_IP=${raw.exitIp}`] : []),
    ...(raw.lat !== undefined && raw.lon !== undefined
      ? [`ENCLAVE_EXIT_LAT=${raw.lat}`, `ENCLAVE_EXIT_LON=${raw.lon}`]
      : []),
  ];
}

/**
 * A new proxy in the same country and timezone can exit in another city. The browser's
 * location follows it (hard rule 3), as "Update location" allows; nothing else changes.
 */
function moveGeolocation(fingerprint: Fingerprint, raw: RawProxyCheck): void {
  if (raw.lat === undefined || raw.lon === undefined || !fingerprint.geolocation) return;
  fingerprint.geolocation = { ...fingerprint.geolocation, lat: raw.lat, lon: raw.lon };
  const config = fingerprint.raw?.config as Record<string, unknown> | undefined;
  if (config && 'geolocation:latitude' in config) {
    config['geolocation:latitude'] = raw.lat;
    config['geolocation:longitude'] = raw.lon;
  }
}

function streamInfo(port: number, stream: NonNullable<ProfileSecrets['stream']>): StreamInfo {
  return {
    url: `http://127.0.0.1:${port}/`,
    ...(stream.phoneHost ? { phoneUrl: `https://${stream.phoneHost}:${port}/` } : {}),
    password: stream.userPassword,
    expiresAt: stream.expiresAt,
  };
}

/** Where the phone app is served: the agent's port, relayed to the tailnet over HTTPS. */
export function phoneAppOrigin(tailnet: TailnetAddress, agentPort: number): string {
  return `https://${tailnet.host}:${agentPort}`;
}

/** /config for the container (images/browser/README.md). proxy.json holds the password: root-only. */
/** A JSON file's content, or undefined when it is missing or unreadable. */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profile'
  );
}

function configFiles(profile: Profile, proxy: ProxyInput): TarEntry[] {
  return [
    { name: 'config/', mode: 0o755 },
    { name: 'config/profile.json', mode: 0o644, content: JSON.stringify(profile) },
    { name: 'config/proxy.json', mode: 0o600, content: JSON.stringify(proxy) },
  ];
}

function configArchive(profile: Profile, proxy: ProxyInput): Buffer {
  return makeTar(configFiles(profile, proxy));
}

/** One check page's outcome, as audit.py records it. */
export interface AuditCheckResult {
  name: string;
  url: string;
  status: 'ok' | 'error';
  error?: string;
  /** Our own pages: their JSON. */
  data?: unknown;
  /** Third-party pages: the page text. */
  text?: string;
  screenshot?: string;
  /** Facts read from markup (e.g. CreepJS's lie marks). */
  extra?: unknown;
  seconds: number;
}

export interface AuditReport {
  startedAt: string;
  finishedAt: string;
  checks: AuditCheckResult[];
  error?: string;
}

export interface AuditJob {
  id: string;
  profileId: string;
  checks: string[];
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  run?: AuditRun;
  error?: string;
}

export interface AuditRun {
  reportDir: string;
  exitIp: string | null;
  report: AuditReport;
  findings: Finding[];
  summary: string;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

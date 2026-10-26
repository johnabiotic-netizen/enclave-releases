#!/usr/bin/env node
// Stage 1 CLI. `enclave serve` runs the agent; every other command talks to it over the local API.

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  API_BASE_PATH,
  type ApiError,
  type CreateProfileRequest,
  type Profile,
  type StartProfileResponse,
  type StreamInfo,
} from '@enclave/shared';
import { startAgent } from './agent.js';
import { loadConfig } from './config.js';

const HELP = `Usage: enclave <command>

  serve                          Run the agent (keep this window open)
  create <name> --proxy <proxy>  Create a profile. Proxy formats:
                                   socks5://user:pass@host:port
                                   http://user:pass@host:port
                                   host:port:user:pass
  create <name> --test-proxy     Create a profile with TEST_PROXY from .env (not for real accounts)
  list                           List profiles
  start <id>                     Start a profile
  open <id>                      Show the profile's address and password, and open it
  stop <id>                      Stop a profile
  check <id>                     Check a profile's proxy
  logs <id>                      Show a profile's log
  delete <id> --yes              Delete a profile and all its data

<id> can be the first few characters of the profile id.`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      proxy: { type: 'string' },
      'test-proxy': { type: 'boolean' },
      yes: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, arg] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  const config = loadConfig();

  if (command === 'serve') {
    const agent = await startAgent(config);
    console.log(`Agent running on http://127.0.0.1:${config.port} (Docker: ${agent.dockerMode}).`);
    console.log(`Profiles are stored in ${config.home}. Press Ctrl+C to stop the agent.`);
    const shutdown = () => void agent.close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const api = new ApiClient(config.port, config.token);
  switch (command) {
    case 'create': {
      if (!arg)
        throw new UsageError('Give the profile a name: enclave create <name> --proxy <proxy>');
      const body: CreateProfileRequest = values['test-proxy']
        ? { name: arg, useTestProxy: true }
        : { name: arg, proxy: values.proxy ?? '' };
      console.log('Checking the proxy and creating the fingerprint. This takes up to a minute.');
      const profile = await api.call<Profile>('POST', '/profiles', body);
      const check = profile.proxy.lastCheck;
      console.log(`Created "${profile.name}" (${profile.id}).`);
      console.log(`Exit IP ${check?.exitIp}, ${check?.country}, ${profile.fingerprint.timezone}.`);
      if (profile.runtime.usesTestProxy) console.log('Test proxy, not for real accounts.');
      break;
    }
    case 'list': {
      const profiles = await api.call<Profile[]>('GET', '/profiles');
      if (!profiles.length) {
        console.log('No profiles yet. Create one with: enclave create <name> --proxy <proxy>');
        break;
      }
      for (const p of profiles) {
        const error = p.status.lastError ? `  (${p.status.lastError})` : '';
        console.log(
          `${p.id.slice(0, 8)}  ${p.status.state.padEnd(8)}  ${p.name}  ${p.proxy.lastCheck?.exitIp ?? ''}${error}`,
        );
      }
      break;
    }
    case 'start': {
      const id = await api.resolveId(arg);
      console.log('Checking the proxy and starting the profile. This takes up to a minute.');
      const { stream } = await api.call<StartProfileResponse>('POST', `/profiles/${id}/start`);
      printStream(stream);
      break;
    }
    case 'open': {
      const id = await api.resolveId(arg);
      const stream = await api.call<StreamInfo>('GET', `/profiles/${id}/stream`);
      printStream(stream);
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '""', stream.url], {
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
        }).unref();
      }
      break;
    }
    case 'stop': {
      const id = await api.resolveId(arg);
      await api.call('POST', `/profiles/${id}/stop`);
      console.log('Stopped. The profile keeps its tabs, logins and history.');
      break;
    }
    case 'check': {
      const id = await api.resolveId(arg);
      const r = await api.call<{
        ok: boolean;
        exitIp?: string;
        country?: string;
        timezone?: string;
        latencyMs?: number;
      }>('POST', `/profiles/${id}/check-proxy`);
      console.log(
        `${r.ok ? 'Proxy OK' : 'Proxy failed the check'}. Exit IP ${r.exitIp ?? 'unknown'}, ${r.country ?? '?'}, ${r.timezone ?? '?'}, ${r.latencyMs ?? '?'} ms.`,
      );
      break;
    }
    case 'logs': {
      const id = await api.resolveId(arg);
      const { lines } = await api.call<{ lines: string[] }>('GET', `/profiles/${id}/logs?tail=200`);
      console.log(lines.join('\n') || 'No log entries yet.');
      break;
    }
    case 'delete': {
      const id = await api.resolveId(arg);
      if (!values.yes)
        throw new UsageError(
          'This removes the profile and all its data. Run again with --yes to go ahead.',
        );
      await api.call('DELETE', `/profiles/${id}?confirm=true`);
      console.log('Deleted.');
      break;
    }
    default:
      throw new UsageError(`Unknown command "${command}".\n\n${HELP}`);
  }
}

function printStream(stream: StreamInfo): void {
  console.log(`Open ${stream.url}`);
  console.log(`Log in with any name and the password ${stream.password}`);
}

class UsageError extends Error {}

class ApiClient {
  private readonly base: string;

  constructor(
    port: number,
    private readonly token: string,
  ) {
    this.base = `http://127.0.0.1:${port}${API_BASE_PATH}`;
  }

  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new UsageError(
        "The agent isn't running. Start it in another window with: enclave serve",
      );
    }
    const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
    if (!res.ok)
      throw new UsageError(data.error?.message ?? `The agent answered HTTP ${res.status}.`);
    return data;
  }

  /** Accepts a full id or a unique prefix of one. */
  async resolveId(arg: string | undefined): Promise<string> {
    if (!arg) throw new UsageError('Which profile? Give its id (or the first few characters).');
    const matches = (await this.call<Profile[]>('GET', '/profiles')).filter((p) =>
      p.id.startsWith(arg),
    );
    if (matches.length === 1) return matches[0]!.id;
    throw new UsageError(
      matches.length
        ? `"${arg}" matches more than one profile. Use more characters.`
        : `No profile with id "${arg}".`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

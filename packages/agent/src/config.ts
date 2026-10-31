import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_PORT } from '@enclave/shared';

export interface AgentConfig {
  token: string;
  port: number;
  /** Folder holding `profiles/<id>/`. */
  home: string;
  image: string;
  /** Raw TEST_PROXY string, if set. For first-run demos only. */
  testProxy: string | undefined;
  dockerHost: string | undefined;
  /** WSL distro running Docker Engine, for PCs without Docker Desktop. */
  wslDistro: string | undefined;
  /** Part of the graphics card's name, on a PC with several (ENCLAVE_GPU). */
  gpu: string | undefined;
  /** Phone access (Stage 2): `tailscale` relays streams and the phone app to the tailnet. */
  phone: 'tailscale' | undefined;
  /** The built phone app (packages/mobile/dist), served by the agent. */
  mobileDir: string;
  /** Real Windows Firefox measurements the audit compares with (testing/reference/). */
  referenceDir: string;
  /** Idle stop for new profiles, in minutes (ENCLAVE_IDLE_MINUTES; default 20). */
  defaultIdleStopMinutes?: number;
}

const MIN_TOKEN_LENGTH = 24;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const token = env.AGENT_TOKEN ?? '';
  if (token.length < MIN_TOKEN_LENGTH || token.startsWith('change-me')) {
    throw new Error(
      `AGENT_TOKEN is missing or too short. Set it in .env to a random string of at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }
  const port = env.AGENT_PORT ? Number(env.AGENT_PORT) : DEFAULT_AGENT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`AGENT_PORT must be a port number, got "${env.AGENT_PORT}".`);
  }
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return {
    token,
    port,
    home: env.ENCLAVE_HOME || path.join(localAppData, 'Enclave'),
    image: env.ENCLAVE_IMAGE || 'enclave-browser:dev',
    testProxy: env.TEST_PROXY || undefined,
    dockerHost: env.DOCKER_HOST || undefined,
    wslDistro: env.ENCLAVE_WSL_DISTRO || undefined,
    gpu: env.ENCLAVE_GPU || undefined,
    phone: phoneMode(env.ENCLAVE_PHONE),
    mobileDir:
      env.ENCLAVE_MOBILE_DIR ||
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mobile/dist'),
    ...(env.ENCLAVE_IDLE_MINUTES
      ? { defaultIdleStopMinutes: idleMinutes(env.ENCLAVE_IDLE_MINUTES) }
      : {}),
    referenceDir:
      env.ENCLAVE_REFERENCE_DIR ||
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../testing/reference/windows-firefox-158',
      ),
  };
}

function idleMinutes(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1440) {
    throw new Error(`ENCLAVE_IDLE_MINUTES must be a whole number from 1 to 1440, got "${value}".`);
  }
  return n;
}

function phoneMode(value: string | undefined): 'tailscale' | undefined {
  if (!value) return undefined;
  if (value === 'tailscale') return 'tailscale';
  throw new Error(`ENCLAVE_PHONE must be "tailscale" or empty, got "${value}".`);
}

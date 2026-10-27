import os from 'node:os';
import path from 'node:path';
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
  };
}

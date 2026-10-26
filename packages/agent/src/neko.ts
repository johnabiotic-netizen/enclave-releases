// The parts of neko's HTTP API the agent uses (neko v3, multiuser members).

export interface NekoSession {
  id: string;
  profile?: { name?: string; is_admin?: boolean };
  state?: { is_connected?: boolean; is_watching?: boolean };
}

const TIMEOUT_MS = 5_000;

export async function nekoReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function nekoLogin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`neko login failed (HTTP ${res.status})`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('neko login returned no token');
  return body.token;
}

export async function nekoSessions(baseUrl: string, token: string): Promise<NekoSession[]> {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`neko sessions failed (HTTP ${res.status})`);
  return (await res.json()) as NekoSession[];
}

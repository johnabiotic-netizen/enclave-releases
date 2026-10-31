// The agent's API through the app's bridge. Errors come back in the agent's own words.

import type { ApiError } from '@enclave/shared';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const reply = await window.enclave.request(method, path, body);
  if (reply.status >= 400) {
    const err = (reply.body as Partial<ApiError> | null)?.error;
    throw new ApiFailure(
      reply.status,
      err?.code ?? 'ERROR',
      err?.message ?? `Request failed (${reply.status}).`,
    );
  }
  return reply.body as T;
}

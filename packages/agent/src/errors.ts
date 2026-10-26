import type { ApiError, ErrorCode } from '@enclave/shared';

const STATUS: Record<ErrorCode, number> = {
  DOCKER_DOWN: 503,
  IMAGE_NOT_BUILT: 503,
  PROXY_UNREACHABLE: 422,
  PROXY_LOCATION_MISMATCH: 422,
  REAL_IP_LEAK_SUSPECTED: 422,
  PROFILE_NOT_FOUND: 404,
  PROFILE_RUNNING: 409,
  PROFILE_NOT_RUNNING: 409,
  INTERNAL: 500,
};

/** An error the API reports as `{ error: { code, message, details } }`. Messages are user-facing. */
export class AgentError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toJSON(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** Bad request input (not one of the spec's error codes): reported as HTTP 400. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

// A simple per-address limit: at most `max` tries per `windowMs`.

export class RateLimitError extends Error {
  readonly statusCode = 429;
  constructor() {
    super('Too many tries. Wait a few minutes and try again.');
  }
}

export class RateLimit {
  private readonly tries = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): void {
    const now = Date.now();
    const recent = (this.tries.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.tries.set(key, recent);
      throw new RateLimitError();
    }
    recent.push(now);
    this.tries.set(key, recent);
    if (this.tries.size > 10_000) {
      for (const [k, v] of this.tries) {
        if (v.every((t) => now - t >= this.windowMs)) this.tries.delete(k);
      }
    }
  }
}

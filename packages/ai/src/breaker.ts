/** Per-model circuit breaker: 5 failures within 60 s skip the model for 60 s (phase2.md, Task 2.3). */
export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_WINDOW_SECONDS = 60;
export const BREAKER_OPEN_SECONDS = 60;

/** Keyed by `ai_models.id`. Only provider-health failures (retryable errors) are recorded. */
export interface BreakerStore {
  isOpen(modelId: string): Promise<boolean>;
  recordFailure(modelId: string): Promise<void>;
  recordSuccess(modelId: string): Promise<void>;
}

/** In-process store for tests and single-process tools; the clock is injectable so TTLs are testable. */
export class MemoryBreakerStore implements BreakerStore {
  private readonly failures = new Map<string, { count: number; expiresAt: number }>();
  private readonly open = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  isOpen(modelId: string): Promise<boolean> {
    const until = this.open.get(modelId);
    if (until === undefined) return Promise.resolve(false);
    if (until <= this.now()) {
      this.open.delete(modelId);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  recordFailure(modelId: string): Promise<void> {
    const now = this.now();
    const current = this.failures.get(modelId);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    this.failures.set(modelId, { count, expiresAt: now + BREAKER_WINDOW_SECONDS * 1_000 });
    if (count >= BREAKER_FAILURE_THRESHOLD) {
      this.open.set(modelId, now + BREAKER_OPEN_SECONDS * 1_000);
    }
    return Promise.resolve();
  }

  recordSuccess(modelId: string): Promise<void> {
    this.failures.delete(modelId);
    return Promise.resolve();
  }
}

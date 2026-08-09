/**
 * Caps concurrent work per key. Used to enforce `DRIVE_RATE_LIMIT_PER_ACCOUNT`:
 * every connected folder syncs sequentially through Drive API calls, so
 * capping concurrent *folder syncs* per account approximates capping
 * concurrent *Drive API calls* per account — the actual quota being
 * protected is the one shared service account's, split fairly across
 * tenants (see M12 decisions). Different keys never block each other, so one
 * heavy account can't starve another's sync run.
 */
export interface ConcurrencyLimiter {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(maxConcurrentPerKey: number): ConcurrencyLimiter {
  if (maxConcurrentPerKey <= 0) {
    throw new Error("maxConcurrentPerKey must be positive");
  }

  const activeCount = new Map<string, number>();
  const waiting = new Map<string, Array<() => void>>();

  function release(key: string): void {
    const remaining = (activeCount.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      activeCount.delete(key);
    } else {
      activeCount.set(key, remaining);
    }

    const queue = waiting.get(key);
    const next = queue?.shift();
    if (next) {
      if (queue!.length === 0) waiting.delete(key);
      next();
    }
  }

  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const attempt = () => {
          const current = activeCount.get(key) ?? 0;
          activeCount.set(key, current + 1);
          fn().then(resolve, reject).finally(() => release(key));
        };

        const current = activeCount.get(key) ?? 0;
        if (current < maxConcurrentPerKey) {
          attempt();
        } else {
          const queue = waiting.get(key) ?? [];
          queue.push(attempt);
          waiting.set(key, queue);
        }
      });
    },
  };
}

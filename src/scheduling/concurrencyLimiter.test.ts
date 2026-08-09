import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "./concurrencyLimiter.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createConcurrencyLimiter", () => {
  it("never exceeds maxConcurrentPerKey active tasks for the same key", async () => {
    const limiter = createConcurrencyLimiter(2);
    let active = 0;
    let maxObserved = 0;
    const gate = deferred<void>();

    const tasks = Array.from({ length: 5 }, () =>
      limiter.run("acct-a", async () => {
        active++;
        maxObserved = Math.max(maxObserved, active);
        await gate.promise;
        active--;
      }),
    );

    // Let the first wave start.
    await new Promise((r) => setTimeout(r, 10));
    expect(maxObserved).toBe(2);

    gate.resolve();
    await Promise.all(tasks);
    expect(maxObserved).toBe(2);
  });

  it("runs all queued tasks eventually, in order of admission", async () => {
    const limiter = createConcurrencyLimiter(1);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limiter.run("acct-a", async () => {
          order.push(n);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("does not let one key's backlog block a different key", async () => {
    const limiter = createConcurrencyLimiter(1);
    const gate = deferred<void>();
    const order: string[] = [];

    const blocked = limiter.run("acct-a", async () => {
      await gate.promise;
      order.push("acct-a-first");
    });
    const alsoBlockedOnA = limiter.run("acct-a", async () => {
      order.push("acct-a-second");
    });
    const differentKey = limiter.run("acct-b", async () => {
      order.push("acct-b");
    });

    await differentKey;
    expect(order).toEqual(["acct-b"]);

    gate.resolve();
    await Promise.all([blocked, alsoBlockedOnA]);
    expect(order).toEqual(["acct-b", "acct-a-first", "acct-a-second"]);
  });

  it("propagates a task's rejection without blocking subsequent tasks for the same key", async () => {
    const limiter = createConcurrencyLimiter(1);

    await expect(
      limiter.run("acct-a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(limiter.run("acct-a", async () => "ok")).resolves.toBe("ok");
  });

  it("rejects a non-positive maxConcurrentPerKey", () => {
    expect(() => createConcurrencyLimiter(0)).toThrow();
    expect(() => createConcurrencyLimiter(-1)).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./driveClient.js";

function errorWithStatus(status: number): Error {
  return Object.assign(new Error(`status ${status}`), { code: status });
}

describe("withRetry", () => {
  it("returns the result on the first attempt when there's no error", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, 3, async () => {});

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries a 429 and succeeds once the underlying call recovers", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw errorWithStatus(429);
      return "recovered";
    });

    const result = await withRetry(fn, 3, async () => {});

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("retries a 5xx the same as a 429", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) throw errorWithStatus(503);
      return "ok";
    });

    await withRetry(fn, 3, async () => {});

    expect(attempts).toBe(2);
  });

  it("does not retry a non-transient error (e.g. 404)", async () => {
    const fn = vi.fn(async () => {
      throw errorWithStatus(404);
    });

    await expect(withRetry(fn, 3, async () => {})).rejects.toThrow("status 404");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("throws the underlying error once retries are exhausted", async () => {
    const fn = vi.fn(async () => {
      throw errorWithStatus(429);
    });

    await expect(withRetry(fn, 2, async () => {})).rejects.toThrow("status 429");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("calls sleepFn with increasing backoff between attempts", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw errorWithStatus(429);
      return "ok";
    });

    await withRetry(fn, 3, async (ms) => {
      sleeps.push(ms);
    });

    expect(sleeps).toEqual([1000, 2000]);
  });
});

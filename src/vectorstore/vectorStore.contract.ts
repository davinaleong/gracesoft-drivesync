import { describe, expect, it } from "vitest";
import type { VectorStore } from "./vectorStore.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueNamespace(label: string): string {
  return `drivesync-contract-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Shared test suite any `VectorStore` implementation must pass — starting
 * with the Pinecone adapter, and required for any contributor-added adapter
 * before merge (see the testing checklist). `settleDelayMs` accommodates
 * real backends with near-real-time (not immediate) read-after-write
 * consistency; fakes/in-memory implementations can leave it at 0.
 */
export function defineVectorStoreContractTests(
  name: string,
  createStore: () => VectorStore,
  settleDelayMs = 0,
): void {
  describe(`${name} (VectorStore contract)`, () => {
    it("upsert-then-query round-trips: the closest upserted vector comes back", async () => {
      const store = createStore();
      const namespace = uniqueNamespace("roundtrip");

      await store.upsert(namespace, [
        { id: "a", values: [1, 0, 0] },
        { id: "b", values: [0, 1, 0] },
      ]);
      await sleep(settleDelayMs);

      const results = await store.query(namespace, [1, 0, 0], 1);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("a");
    });

    it("delete removes the record from subsequent queries", async () => {
      const store = createStore();
      const namespace = uniqueNamespace("delete");

      await store.upsert(namespace, [
        { id: "a", values: [1, 0, 0] },
        { id: "b", values: [0, 1, 0] },
      ]);
      await sleep(settleDelayMs);

      await store.delete(namespace, ["a"]);
      await sleep(settleDelayMs);

      const results = await store.query(namespace, [1, 0, 0], 2);
      expect(results.map((r) => r.id)).not.toContain("a");
    });

    it("keeps namespaces isolated, even with the same vector ID and content in both", async () => {
      const store = createStore();
      const namespaceA = uniqueNamespace("iso-a");
      const namespaceB = uniqueNamespace("iso-b");

      await store.upsert(namespaceA, [{ id: "shared-id", values: [1, 0, 0] }]);
      await store.upsert(namespaceB, [{ id: "shared-id", values: [1, 0, 0] }]);
      await sleep(settleDelayMs);

      await store.delete(namespaceA, ["shared-id"]);
      await sleep(settleDelayMs);

      const resultsA = await store.query(namespaceA, [1, 0, 0], 5);
      const resultsB = await store.query(namespaceB, [1, 0, 0], 5);

      expect(resultsA).toHaveLength(0);
      expect(resultsB.map((r) => r.id)).toContain("shared-id");
    });

    it("reports a dimension that is either unknown or a positive integer", async () => {
      const store = createStore();
      const namespace = uniqueNamespace("dimension");
      await store.upsert(namespace, [{ id: "a", values: [1, 0, 0] }]);
      await sleep(settleDelayMs);

      const dimension = await store.getDimension();

      if (dimension !== undefined) {
        expect(Number.isInteger(dimension)).toBe(true);
        expect(dimension).toBeGreaterThan(0);
      }
    });
  });
}

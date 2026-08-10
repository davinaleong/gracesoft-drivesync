import { describe, expect, it, vi } from "vitest";
import { defineEmbeddingProviderContractTests } from "./embeddingProvider.contract.js";
import type { OpenAiEmbeddingClient } from "./openaiEmbeddingProvider.js";
import { createOpenAiEmbeddingProvider } from "./openaiEmbeddingProvider.js";

const DIMENSIONS = 1536;

function fakeVector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => (i === 0 ? seed : 0));
}

function makeFakeClient(): OpenAiEmbeddingClient {
  return {
    createEmbeddings: vi.fn(async (input: string[]) => input.map((text) => fakeVector(Number(text.split("-")[1] ?? 0)))),
  };
}

defineEmbeddingProviderContractTests("OpenAI adapter", () =>
  createOpenAiEmbeddingProvider({ client: makeFakeClient(), model: "text-embedding-3-small" }),
);

describe("createOpenAiEmbeddingProvider", () => {
  it("throws for a model with no known dimensions, instead of silently returning wrong-shaped vectors", () => {
    expect(() =>
      createOpenAiEmbeddingProvider({ client: makeFakeClient(), model: "not-a-real-model" }),
    ).toThrow(/Unknown embedding dimensions/);
  });

  it("preserves input order across internal batches", async () => {
    const client = makeFakeClient();
    const provider = createOpenAiEmbeddingProvider({ client, model: "text-embedding-3-small", batchSize: 10 });
    const texts = Array.from({ length: 25 }, (_, i) => `text-${i}`);

    const vectors = await provider.embed(texts);

    vectors.forEach((vector, i) => {
      expect(vector[0]).toBe(i);
    });
    expect(client.createEmbeddings).toHaveBeenCalledTimes(3); // 10 + 10 + 5
  });

  it("retries a transient (429/5xx) failure and succeeds within maxRetries", async () => {
    let attempts = 0;
    const client: OpenAiEmbeddingClient = {
      createEmbeddings: vi.fn(async (input: string[]) => {
        attempts += 1;
        if (attempts < 3) {
          throw { status: 429 };
        }
        return input.map(() => fakeVector(0));
      }),
    };

    const provider = createOpenAiEmbeddingProvider({
      client,
      model: "text-embedding-3-small",
      maxRetries: 3,
      sleepFn: async () => {},
    });

    const vectors = await provider.embed(["a"]);

    expect(vectors).toHaveLength(1);
    expect(attempts).toBe(3);
  });

  it("does not retry a non-transient error", async () => {
    const client: OpenAiEmbeddingClient = {
      createEmbeddings: vi.fn(async () => {
        throw { status: 401 };
      }),
    };

    const provider = createOpenAiEmbeddingProvider({
      client,
      model: "text-embedding-3-small",
      sleepFn: async () => {},
    });

    await expect(provider.embed(["a"])).rejects.toEqual({ status: 401 });
    expect(client.createEmbeddings).toHaveBeenCalledTimes(1);
  });

  it("throws once retries are exhausted on a persistent transient failure", async () => {
    const client: OpenAiEmbeddingClient = {
      createEmbeddings: vi.fn(async () => {
        throw { status: 500 };
      }),
    };

    const provider = createOpenAiEmbeddingProvider({
      client,
      model: "text-embedding-3-small",
      maxRetries: 2,
      sleepFn: async () => {},
    });

    await expect(provider.embed(["a"])).rejects.toEqual({ status: 500 });
    expect(client.createEmbeddings).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("reports the requested dimensions, not the model's native one, when an override is given", () => {
    const provider = createOpenAiEmbeddingProvider({
      client: makeFakeClient(),
      model: "text-embedding-3-small",
      dimensions: 512,
    });

    expect(provider.dimensions).toBe(512);
  });

  it("passes the dimensions override through to the client on every call", async () => {
    const client = makeFakeClient();
    const provider = createOpenAiEmbeddingProvider({ client, model: "text-embedding-3-small", dimensions: 512 });

    await provider.embed(["a"]);

    expect(client.createEmbeddings).toHaveBeenCalledWith(["a"], "text-embedding-3-small", 512);
  });

  it("does not pass a dimensions argument when no override is configured", async () => {
    const client = makeFakeClient();
    const provider = createOpenAiEmbeddingProvider({ client, model: "text-embedding-3-small" });

    await provider.embed(["a"]);

    expect(client.createEmbeddings).toHaveBeenCalledWith(["a"], "text-embedding-3-small", undefined);
  });

  it("rejects a dimensions override on a model that doesn't support it", () => {
    expect(() =>
      createOpenAiEmbeddingProvider({ client: makeFakeClient(), model: "text-embedding-ada-002", dimensions: 512 }),
    ).toThrow(/does not support a custom "dimensions"/);
  });

  it("rejects a dimensions override larger than the model's native dimension", () => {
    expect(() =>
      createOpenAiEmbeddingProvider({ client: makeFakeClient(), model: "text-embedding-3-small", dimensions: 4000 }),
    ).toThrow(/exceeds/);
  });
});

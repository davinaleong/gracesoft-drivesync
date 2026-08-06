import OpenAI from "openai";
import type { EmbeddingProvider } from "./embeddingProvider.js";

// Dimension is fixed per model and baked into the vector store index at
// creation time (see M9) — not something a caller can override.
const KNOWN_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export interface OpenAiEmbeddingClient {
  createEmbeddings(input: string[], model: string): Promise<number[][]>;
}

export function createOpenAiEmbeddingClient(apiKey: string): OpenAiEmbeddingClient {
  const client = new OpenAI({ apiKey });
  return {
    async createEmbeddings(input: string[], model: string): Promise<number[][]> {
      const res = await client.embeddings.create({ input, model });
      return res.data.map((d) => d.embedding);
    },
  };
}

function isRetryableStatus(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OpenAiEmbeddingProviderOptions {
  client: OpenAiEmbeddingClient;
  model: string;
  batchSize?: number;
  maxRetries?: number;
  /** Test-only hook to avoid real timers in retry/backoff tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export function createOpenAiEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): EmbeddingProvider {
  const dimensions = KNOWN_MODEL_DIMENSIONS[options.model];
  if (!dimensions) {
    throw new Error(
      `Unknown embedding dimensions for OpenAI model "${options.model}". ` +
        `Known models: ${Object.keys(KNOWN_MODEL_DIMENSIONS).join(", ")}.`,
    );
  }

  const batchSize = options.batchSize ?? 100;
  const maxRetries = options.maxRetries ?? 3;
  const sleepFn = options.sleepFn ?? sleep;

  async function embedBatchWithRetry(batch: string[]): Promise<number[][]> {
    let attempt = 0;
    for (;;) {
      try {
        return await options.client.createEmbeddings(batch, options.model);
      } catch (err) {
        attempt += 1;
        if (attempt > maxRetries || !isRetryableStatus(err)) throw err;
        await sleepFn(backoffMs(attempt));
      }
    }
  }

  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        results.push(...(await embedBatchWithRetry(batch)));
      }
      return results;
    },
  };
}

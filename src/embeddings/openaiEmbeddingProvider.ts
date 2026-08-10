import OpenAI from "openai";
import type { EmbeddingProvider } from "./embeddingProvider.js";

// Native (maximum) dimension per model — what you get without requesting a
// truncated output. A caller can ask for fewer via `dimensions` (see below)
// on the two models that support it; whatever the effective dimension ends
// up being still gets baked into the vector store index at creation time
// (M9) and can't change later without a full resync.
const KNOWN_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

// Only the newer text-embedding-3-* models accept a `dimensions` request
// parameter to truncate their output; ada-002 has no such option.
const MODELS_SUPPORTING_DIMENSIONS_PARAM = new Set(["text-embedding-3-small", "text-embedding-3-large"]);

export interface OpenAiEmbeddingClient {
  createEmbeddings(input: string[], model: string, dimensions?: number): Promise<number[][]>;
}

export function createOpenAiEmbeddingClient(apiKey: string): OpenAiEmbeddingClient {
  const client = new OpenAI({ apiKey });
  return {
    async createEmbeddings(input: string[], model: string, dimensions?: number): Promise<number[][]> {
      const res = await client.embeddings.create({ input, model, ...(dimensions ? { dimensions } : {}) });
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
  /** Requests a truncated output instead of the model's native dimension — only text-embedding-3-small/-large support this. */
  dimensions?: number;
  batchSize?: number;
  maxRetries?: number;
  /** Test-only hook to avoid real timers in retry/backoff tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export function createOpenAiEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): EmbeddingProvider {
  const nativeDimensions = KNOWN_MODEL_DIMENSIONS[options.model];
  if (!nativeDimensions) {
    throw new Error(
      `Unknown embedding dimensions for OpenAI model "${options.model}". ` +
        `Known models: ${Object.keys(KNOWN_MODEL_DIMENSIONS).join(", ")}.`,
    );
  }

  if (options.dimensions !== undefined) {
    if (!MODELS_SUPPORTING_DIMENSIONS_PARAM.has(options.model)) {
      throw new Error(
        `Model "${options.model}" does not support a custom "dimensions" value — only ` +
          `${[...MODELS_SUPPORTING_DIMENSIONS_PARAM].join(", ")} do. Omit OPENAI_EMBEDDING_DIMENSIONS ` +
          `or switch models.`,
      );
    }
    if (options.dimensions > nativeDimensions) {
      throw new Error(
        `Requested dimensions (${options.dimensions}) exceeds "${options.model}"'s native dimension (${nativeDimensions}).`,
      );
    }
  }

  const dimensions = options.dimensions ?? nativeDimensions;
  const batchSize = options.batchSize ?? 100;
  const maxRetries = options.maxRetries ?? 3;
  const sleepFn = options.sleepFn ?? sleep;

  async function embedBatchWithRetry(batch: string[]): Promise<number[][]> {
    let attempt = 0;
    for (;;) {
      try {
        return await options.client.createEmbeddings(batch, options.model, options.dimensions);
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

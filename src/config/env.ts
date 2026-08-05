import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  API_KEY_PEPPER: z.string().min(1, "API_KEY_PEPPER is required"),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_EMAIL is required"),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z
    .string()
    .min(1, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is required"),

  EMBEDDING_PROVIDER: z.string().default("openai"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  VECTOR_STORE: z.string().default("pinecone"),
  PINECONE_API_KEY: z.string().min(1, "PINECONE_API_KEY is required"),
  PINECONE_INDEX_NAME: z.string().default("drivesync"),

  SYNC_CRON: z.string().default("*/15 * * * *"),
  DRIVE_RATE_LIMIT_PER_ACCOUNT: z.coerce.number().int().positive().default(5),

  MCP_SERVER_PORT: z.coerce.number().int().positive().default(3001),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Fails fast with a clear message on any missing/invalid required var,
// instead of surfacing as a confusing runtime error deep in the pipeline.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = result.data;
  return cached;
}

// Test-only: clears the cached env so a test can call loadEnv() again with a different source.
export function resetEnvCacheForTests(): void {
  cached = undefined;
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://drivesync:drivesync@localhost:5432/drivesync_test",
      REDIS_URL: "redis://localhost:6379",
      API_KEY_PEPPER: "test-pepper-not-for-production-use-only",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "test-key",
      OPENAI_API_KEY: "test-key",
      PINECONE_API_KEY: "test-key",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});

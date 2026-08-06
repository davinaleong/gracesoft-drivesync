import express from "express";
import { pinoHttp } from "pino-http";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createRequireApiKey } from "./middleware/requireApiKey.js";
import { createPrismaApiKeyRepository } from "./auth/apiKeyRepository.js";
import type { ApiKeyRepository } from "./auth/apiKeyRepository.js";

const env = loadEnv();

export function createApp(apiKeyRepository: ApiKeyRepository = createPrismaApiKeyRepository()) {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  const requireApiKey = createRequireApiKey(apiKeyRepository);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/me", requireApiKey, (req, res) => {
    res.json({ account: req.account });
  });

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "server listening");
  });
}

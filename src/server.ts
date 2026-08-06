import express from "express";
import { pinoHttp } from "pino-http";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createRequireApiKey } from "./middleware/requireApiKey.js";
import { createPrismaApiKeyRepository } from "./auth/apiKeyRepository.js";
import type { ApiKeyRepository } from "./auth/apiKeyRepository.js";
import { createFoldersRouter } from "./folders/foldersRouter.js";
import { createFolderService } from "./folders/folderService.js";
import type { FolderService } from "./folders/folderService.js";
import { createPrismaFolderRepository } from "./folders/folderRepository.js";
import { createGoogleDriveClient } from "./drive/driveClient.js";

const env = loadEnv();

function defaultFolderService(): FolderService {
  return createFolderService({
    driveClient: createGoogleDriveClient(),
    repository: createPrismaFolderRepository(),
  });
}

export function createApp(
  apiKeyRepository: ApiKeyRepository = createPrismaApiKeyRepository(),
  folderService: FolderService = defaultFolderService(),
) {
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

  app.use(requireApiKey, createFoldersRouter(folderService, env.GOOGLE_SERVICE_ACCOUNT_EMAIL));

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "server listening");
  });
}

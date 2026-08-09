import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createTiktokenTokenizer } from "./chunking/chunkText.js";
import { loadEnv } from "./config/env.js";
import { createGoogleDriveClient } from "./drive/driveClient.js";
import { createEmbeddingProvider } from "./embeddings/index.js";
import { createPdfParser, createTextExtractor } from "./extraction/textExtractor.js";
import { createPrismaFolderRepository } from "./folders/folderRepository.js";
import { logger } from "./lib/logger.js";
import { createConcurrencyLimiter } from "./scheduling/concurrencyLimiter.js";
import { createPrismaFileRepository } from "./sync/fileRepository.js";
import { createSyncRunner } from "./sync/syncAllFolders.js";
import { createFolderSyncer } from "./sync/syncFolder.js";
import { createVectorStore } from "./vectorstore/index.js";

const SYNC_QUEUE_NAME = "drivesync-sync";
const SCHEDULED_JOB_ID = "scheduled-sync";
// Fits comfortably under text-embedding-3-small's 8191-token input limit
// with room for several chunks batched per request; overlap is 10% of
// budget, consistent with typical RAG chunking guidance.
const CHUNK_OPTIONS = { maxTokens: 500, overlapTokens: 50 };

const env = loadEnv();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const driveClient = createGoogleDriveClient();
const embeddingProvider = createEmbeddingProvider();
const vectorStore = createVectorStore();
const folderSyncer = createFolderSyncer({
  driveClient,
  fileRepository: createPrismaFileRepository(),
  textExtractor: createTextExtractor({ driveClient, pdfParser: createPdfParser() }),
  tokenizer: createTiktokenTokenizer(),
  embeddingProvider,
  vectorStore,
  chunkOptions: CHUNK_OPTIONS,
});
const syncRunner = createSyncRunner({
  folderRepository: createPrismaFolderRepository(),
  folderSyncer,
  concurrencyLimiter: createConcurrencyLimiter(env.DRIVE_RATE_LIMIT_PER_ACCOUNT),
  embeddingProvider,
  vectorStore,
});

const queue = new Queue(SYNC_QUEUE_NAME, { connection });

const worker = new Worker(
  SYNC_QUEUE_NAME,
  async () => {
    logger.info("sync run started");
    const summary = await syncRunner.runSync();
    const failed = summary.folders.filter((f) => !f.ok);
    logger.info(
      { folderCount: summary.folders.length, failedFolderCount: failed.length },
      "sync run completed",
    );
    if (failed.length > 0) {
      logger.warn({ failed }, "one or more folders failed to sync this run");
    }
    return summary;
  },
  { connection },
);

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "sync job threw and will be retried per BullMQ's default backoff");
});

// Idempotent: a fixed jobId means re-running this on every worker start
// (deploys, restarts) reschedules the same repeatable job rather than
// accumulating duplicates.
await queue.add(SCHEDULED_JOB_ID, {}, { repeat: { pattern: env.SYNC_CRON }, jobId: SCHEDULED_JOB_ID });

logger.info({ cron: env.SYNC_CRON }, "worker started — scheduled sync job registered");

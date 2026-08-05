import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";

// BullMQ queue/worker wiring lands in M12 (Scheduling). This is scaffolding
// only, so `npm run worker` has something valid to run in the meantime.
loadEnv();
logger.info("worker scaffold started — sync queue processing lands in M12");

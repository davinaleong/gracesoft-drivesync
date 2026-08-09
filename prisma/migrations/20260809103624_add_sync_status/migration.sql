-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "drive_folders" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncStatus" "SyncStatus",
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

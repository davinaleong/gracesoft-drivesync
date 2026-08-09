-- CreateTable
CREATE TABLE "drive_files" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "modifiedTime" TEXT NOT NULL,
    "contentHash" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drive_files_accountId_idx" ON "drive_files"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_files_driveFolderId_fileId_key" ON "drive_files"("driveFolderId", "fileId");

-- AddForeignKey
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_driveFolderId_fkey" FOREIGN KEY ("driveFolderId") REFERENCES "drive_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

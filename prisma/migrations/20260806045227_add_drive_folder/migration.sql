-- CreateEnum
CREATE TYPE "FolderStatus" AS ENUM ('CONNECTED', 'NOT_ACCESSIBLE');

-- CreateTable
CREATE TABLE "drive_folders" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "status" "FolderStatus" NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drive_folders_accountId_idx" ON "drive_folders"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_folders_accountId_folderId_key" ON "drive_folders"("accountId", "folderId");

-- AddForeignKey
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

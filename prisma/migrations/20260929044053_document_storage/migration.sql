-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('GENERATED', 'IMPORTED');

-- AlterTable
ALTER TABLE "InvoiceDocument" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "driveName" TEXT,
ADD COLUMN     "size" INTEGER,
ADD COLUMN     "source" "DocumentSource" NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN     "syncError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "data" DROP NOT NULL;

-- CreateTable
CREATE TABLE "DriveTrash" (
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveTrash_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

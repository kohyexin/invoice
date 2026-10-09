-- Agreements: AcroForm templates (PCI, PAAS), filled agreements linked to a client,
-- and their PDFs (unsigned now, signed copies in phase 2).

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'FINALIZED', 'SENT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AgreementDocumentVariant" AS ENUM ('FILLED', 'SIGNED');

-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pdf" BYTEA NOT NULL,
    "pdfFilename" TEXT NOT NULL DEFAULT '',
    "fieldConfig" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'FINALIZED',
    "values" JSONB NOT NULL DEFAULT '{}',
    "agreementRef" TEXT NOT NULL DEFAULT '',
    "finalizedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementDocument" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "variant" "AgreementDocumentVariant" NOT NULL DEFAULT 'FILLED',
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
    "data" BYTEA,
    "size" INTEGER,
    "driveFileId" TEXT,
    "driveFolderId" TEXT,
    "driveName" TEXT,
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgreementTemplate_name_key" ON "AgreementTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementTemplate_code_key" ON "AgreementTemplate"("code");

-- CreateIndex
CREATE INDEX "Agreement_clientId_idx" ON "Agreement"("clientId");

-- CreateIndex
CREATE INDEX "Agreement_templateId_idx" ON "Agreement"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementDocument_agreementId_variant_key" ON "AgreementDocument"("agreementId", "variant");

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AgreementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementDocument" ADD CONSTRAINT "AgreementDocument_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

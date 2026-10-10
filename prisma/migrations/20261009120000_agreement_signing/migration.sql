-- Agreement e-signing: signers (emailed links, drawn signatures) and the signing audit trail.

-- AlterTable
ALTER TABLE "Agreement" ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "AgreementSignerStatus" AS ENUM ('PENDING', 'VIEWED', 'SIGNED');

-- CreateTable
CREATE TABLE "AgreementSigner" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "AgreementSignerStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signature" BYTEA,
    "signedIp" TEXT NOT NULL DEFAULT '',
    "signedUserAgent" TEXT NOT NULL DEFAULT '',
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSigningEvent" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "signerId" TEXT,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementSigningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSigner_tokenHash_key" ON "AgreementSigner"("tokenHash");

-- CreateIndex
CREATE INDEX "AgreementSigner_agreementId_idx" ON "AgreementSigner"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSigner_agreementId_roleKey_key" ON "AgreementSigner"("agreementId", "roleKey");

-- CreateIndex
CREATE INDEX "AgreementSigningEvent_agreementId_idx" ON "AgreementSigningEvent"("agreementId");

-- AddForeignKey
ALTER TABLE "AgreementSigner" ADD CONSTRAINT "AgreementSigner_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSigningEvent" ADD CONSTRAINT "AgreementSigningEvent_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSigningEvent" ADD CONSTRAINT "AgreementSigningEvent_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "AgreementSigner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

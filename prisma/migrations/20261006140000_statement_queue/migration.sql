-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('PENDING', 'IMPORTED', 'REJECTED', 'IN_EXCEL');

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "file" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "opening" DECIMAL(16,2) NOT NULL,
    "closing" DECIMAL(16,2) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementLine" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountIn" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "amountOut" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT '',
    "party" TEXT NOT NULL DEFAULT '',
    "memo" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "counterparty" TEXT NOT NULL DEFAULT '',
    "suggested" TEXT NOT NULL DEFAULT 'none',
    "status" "StatementLineStatus" NOT NULL DEFAULT 'PENDING',
    "cashTxnId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementImport_accountId_periodStart_idx" ON "StatementImport"("accountId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "StatementLine_key_key" ON "StatementLine"("key");

-- CreateIndex
CREATE INDEX "StatementLine_status_idx" ON "StatementLine"("status");

-- CreateIndex
CREATE INDEX "StatementLine_accountId_idx" ON "StatementLine"("accountId");

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "StatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CashCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

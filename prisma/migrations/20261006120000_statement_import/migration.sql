-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "accountType" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CashTxn" ADD COLUMN     "importKey" TEXT;

-- CreateTable
CREATE TABLE "CashHint" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "categoryId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT '',
    "party" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashHint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashHint_accountId_counterparty_direction_key" ON "CashHint"("accountId", "counterparty", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "CashTxn_importKey_key" ON "CashTxn"("importKey");

-- AddForeignKey
ALTER TABLE "CashHint" ADD CONSTRAINT "CashHint_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

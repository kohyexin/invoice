-- CreateEnum
CREATE TYPE "AccountUse" AS ENUM ('INVOICE', 'BALANCE', 'BOTH');

-- CreateEnum
CREATE TYPE "CashKind" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- AlterEnum
ALTER TYPE "Currency" ADD VALUE 'CNH';

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "use" "AccountUse" NOT NULL DEFAULT 'INVOICE';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "invoicing" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CashCategory" (
    "id" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "kind" "CashKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CashCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTxn" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT '',
    "party" TEXT NOT NULL DEFAULT '',
    "memo" TEXT NOT NULL DEFAULT '',
    "amountIn" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "amountOut" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashCategory_nameZh_key" ON "CashCategory"("nameZh");

-- CreateIndex
CREATE INDEX "CashTxn_accountId_date_idx" ON "CashTxn"("accountId", "date");

-- CreateIndex
CREATE INDEX "CashTxn_date_idx" ON "CashTxn"("date");

-- CreateIndex
CREATE INDEX "CashTxn_categoryId_idx" ON "CashTxn"("categoryId");

-- CreateIndex
CREATE INDEX "CashTxn_invoiceId_idx" ON "CashTxn"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CashTxn_sourceSheet_sourceRow_key" ON "CashTxn"("sourceSheet", "sourceRow");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTxn" ADD CONSTRAINT "CashTxn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTxn" ADD CONSTRAINT "CashTxn_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CashCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTxn" ADD CONSTRAINT "CashTxn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

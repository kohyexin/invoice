-- Money a book account holds that its statements don't show (e.g. Airwallex Yield).
ALTER TABLE "BankAccount" ADD COLUMN "offStatement" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- Remembered split of a counterparty's bank lines.
ALTER TABLE "CashHint" ADD COLUMN "splits" JSONB;

-- Statement lines: split rows, and the client and invoices a receipt pays.
ALTER TABLE "StatementLine" ADD COLUMN "splits" JSONB;
ALTER TABLE "StatementLine" ADD COLUMN "clientId" TEXT;
ALTER TABLE "StatementLine" ADD COLUMN "invoiceIds" JSONB;

-- Credit that came in with a cash book receipt.
ALTER TABLE "ClientCredit" ADD COLUMN "cashTxnId" TEXT;
CREATE INDEX "ClientCredit_cashTxnId_idx" ON "ClientCredit"("cashTxnId");

-- AlterTable: 使用月, filled from the line date for rows already imported.
ALTER TABLE "CashTxn" ADD COLUMN "period" DATE;
UPDATE "CashTxn" SET "period" = date_trunc('month', "date")::date;
ALTER TABLE "CashTxn" ALTER COLUMN "period" SET NOT NULL;

-- CreateIndex
CREATE INDEX "CashTxn_period_idx" ON "CashTxn"("period");

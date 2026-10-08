-- AlterTable: months between a counterparty's line date and its 使用月 (e.g. salary paid on the 10th for the month before).
ALTER TABLE "CashHint" ADD COLUMN "periodLag" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: suggested 使用月 for lines waiting for approval; null means the month of the date.
ALTER TABLE "StatementLine" ADD COLUMN "period" DATE;

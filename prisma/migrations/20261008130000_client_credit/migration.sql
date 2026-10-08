-- CreateTable: client credit from overpayments, used up by later invoices.
CREATE TABLE "ClientCredit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "invoiceId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientCredit_clientId_currency_idx" ON "ClientCredit"("clientId", "currency");
CREATE INDEX "ClientCredit_invoiceId_idx" ON "ClientCredit"("invoiceId");

-- AddForeignKey
ALTER TABLE "ClientCredit" ADD CONSTRAINT "ClientCredit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCredit" ADD CONSTRAINT "ClientCredit_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

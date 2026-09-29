-- AlterEnum
ALTER TYPE "ReviewStatus" ADD VALUE 'DUPLICATE';

-- AlterTable
ALTER TABLE "ImportReview" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "invoiceNumber" TEXT;

-- CreateIndex
CREATE INDEX "ImportReview_status_idx" ON "ImportReview"("status");

-- CreateIndex
CREATE INDEX "ImportReview_invoiceNumber_idx" ON "ImportReview"("invoiceNumber");

-- AddForeignKey
ALTER TABLE "ImportReview" ADD CONSTRAINT "ImportReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportReview" ADD CONSTRAINT "ImportReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

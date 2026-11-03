-- Additive migration. Refuse ambiguous existing payment references; do not delete history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Transaction" GROUP BY "productId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate Transaction.productId values require manual review before migration';
  END IF;
END $$;
ALTER TABLE "AcademicCourse" ADD COLUMN "isMonetized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "price" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "discountPrice" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "beneficiaryUserId" TEXT;
CREATE UNIQUE INDEX "Transaction_productId_key" ON "Transaction"("productId");
CREATE INDEX "Transaction_beneficiaryUserId_idx" ON "Transaction"("beneficiaryUserId");
ALTER TABLE "WithdrawalRequest" ALTER COLUMN "artistId" DROP NOT NULL;
ALTER TABLE "UserSubscription" ADD COLUMN "transactionId" TEXT;
CREATE UNIQUE INDEX "UserSubscription_transactionId_key" ON "UserSubscription"("transactionId");
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

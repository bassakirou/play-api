CREATE TABLE "CreatorPlan" (
  "id" TEXT PRIMARY KEY,
  "creatorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "cadence" TEXT NOT NULL,
  "contentTypes" TEXT[] NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CreatorPlan_creatorId_active_idx" ON "CreatorPlan"("creatorId", "active");
CREATE TABLE "CreatorMembership" (
  "id" TEXT PRIMARY KEY,
  "subscriberId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "creatorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "planId" TEXT NOT NULL,
  "planName" TEXT NOT NULL,
  "contentTypes" TEXT[] NOT NULL,
  "transactionId" TEXT NOT NULL UNIQUE REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CreatorMembership_subscriberId_creatorId_endsAt_idx" ON "CreatorMembership"("subscriberId", "creatorId", "endsAt");

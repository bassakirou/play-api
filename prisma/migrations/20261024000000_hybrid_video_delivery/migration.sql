-- Additive migration. Apply only after a backup and environment verification.
ALTER TABLE "MediaAsset" ADD COLUMN "originalBucket" TEXT, ADD COLUMN "originalObject" TEXT;
ALTER TABLE "Video" ADD COLUMN "mediaAssetId" TEXT, ADD COLUMN "publishWhenReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Video" ADD CONSTRAINT "Video_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Video_mediaAssetId_idx" ON "Video"("mediaAssetId");
CREATE INDEX "Video_publishWhenReady_mediaAssetId_idx" ON "Video"("publishWhenReady", "mediaAssetId");
CREATE TABLE "VideoDelivery" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'CLOUDFLARE',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "remoteUid" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "failureCode" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoDelivery_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VideoDelivery_mediaAssetId_key" ON "VideoDelivery"("mediaAssetId");
CREATE UNIQUE INDEX "VideoDelivery_remoteUid_key" ON "VideoDelivery"("remoteUid");
CREATE INDEX "VideoDelivery_status_nextAttemptAt_idx" ON "VideoDelivery"("status", "nextAttemptAt");

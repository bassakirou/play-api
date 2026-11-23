ALTER TABLE "LiveStream" ADD COLUMN "cloudflareInputId" TEXT,
ADD COLUMN "replaySourceObject" TEXT,
ADD COLUMN "cloudflareReplayId" TEXT,
ADD COLUMN "cloudflareReplayStatus" TEXT NOT NULL DEFAULT 'PENDING';

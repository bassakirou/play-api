-- CreateTable
CREATE TABLE "VideoPlaybackSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "playing" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "playedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reportedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bufferSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stalls" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "startupMs" DOUBLE PRECISION,
    "height" INTEGER,

    CONSTRAINT "VideoPlaybackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMonitorSample" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPercent" DOUBLE PRECISION,
    "memoryPercent" DOUBLE PRECISION,
    "diskPercent" DOUBLE PRECISION,
    "nodeRssBytes" DOUBLE PRECISION NOT NULL,
    "networkRxBps" DOUBLE PRECISION,
    "networkTxBps" DOUBLE PRECISION,
    "networkCapacityMbps" DOUBLE PRECISION,
    "databaseOk" BOOLEAN,
    "minioOk" BOOLEAN,
    "databaseMs" DOUBLE PRECISION,
    "minioMs" DOUBLE PRECISION,
    "disks" JSONB NOT NULL,
    "activeSessions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VideoMonitorSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMonitorAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "occurrences" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VideoMonitorAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudflareUsageSnapshot" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "minutesDelivered" DOUBLE PRECISION NOT NULL,
    "storedMinutes" DOUBLE PRECISION,
    "capacityMinutes" DOUBLE PRECISION,
    "daily" JSONB NOT NULL,
    "countries" JSONB NOT NULL,

    CONSTRAINT "CloudflareUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoExternalProbe" (
    "id" TEXT NOT NULL,
    "probeId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" DOUBLE PRECISION,

    CONSTRAINT "VideoExternalProbe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoPlaybackSession_playing_expiresAt_idx" ON "VideoPlaybackSession"("playing", "expiresAt");

-- CreateIndex
CREATE INDEX "VideoPlaybackSession_startedAt_videoId_idx" ON "VideoPlaybackSession"("startedAt", "videoId");

-- CreateIndex
CREATE INDEX "VideoMonitorSample_hostId_sampledAt_idx" ON "VideoMonitorSample"("hostId", "sampledAt");

-- CreateIndex
CREATE INDEX "VideoMonitorSample_sampledAt_idx" ON "VideoMonitorSample"("sampledAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMonitorAlert_key_key" ON "VideoMonitorAlert"("key");

-- CreateIndex
CREATE INDEX "VideoExternalProbe_observedAt_idx" ON "VideoExternalProbe"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoExternalProbe_probeId_observedAt_key" ON "VideoExternalProbe"("probeId", "observedAt");

-- AddForeignKey
ALTER TABLE "VideoPlaybackSession" ADD CONSTRAINT "VideoPlaybackSession_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

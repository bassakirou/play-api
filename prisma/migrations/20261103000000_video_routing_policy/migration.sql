CREATE TABLE "VideoRoutingPolicy" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "mode" TEXT NOT NULL DEFAULT 'CLOUDFLARE_FIRST',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoRoutingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoRoutingPolicy_mode_check" CHECK ("mode" IN ('CLOUDFLARE_FIRST', 'LOCAL_ONLY'))
);

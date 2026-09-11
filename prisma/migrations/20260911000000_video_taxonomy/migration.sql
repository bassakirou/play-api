CREATE TABLE "VideoCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoTag" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "categoryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VideoTagOnVideo" (
  "videoId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "VideoTagOnVideo_pkey" PRIMARY KEY ("videoId", "tagId")
);

CREATE TABLE "VideoTaxonomyEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "country" TEXT,
  "videoId" TEXT,
  "categoryId" TEXT,
  "tagId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoTaxonomyEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Video" ADD COLUMN "categoryId" TEXT;

CREATE UNIQUE INDEX "VideoCategory_name_key" ON "VideoCategory"("name");
CREATE UNIQUE INDEX "VideoCategory_normalizedName_key" ON "VideoCategory"("normalizedName");
CREATE INDEX "VideoCategory_normalizedName_idx" ON "VideoCategory"("normalizedName");
CREATE UNIQUE INDEX "VideoTag_normalizedName_key" ON "VideoTag"("normalizedName");
CREATE INDEX "VideoTag_categoryId_idx" ON "VideoTag"("categoryId");
CREATE INDEX "VideoTagOnVideo_tagId_idx" ON "VideoTagOnVideo"("tagId");
CREATE INDEX "VideoTaxonomyEvent_type_createdAt_idx" ON "VideoTaxonomyEvent"("type", "createdAt");
CREATE INDEX "VideoTaxonomyEvent_country_createdAt_idx" ON "VideoTaxonomyEvent"("country", "createdAt");
CREATE INDEX "VideoTaxonomyEvent_categoryId_createdAt_idx" ON "VideoTaxonomyEvent"("categoryId", "createdAt");
CREATE INDEX "VideoTaxonomyEvent_tagId_createdAt_idx" ON "VideoTaxonomyEvent"("tagId", "createdAt");

ALTER TABLE "Video" ADD CONSTRAINT "Video_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoTag" ADD CONSTRAINT "VideoTag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoTagOnVideo" ADD CONSTRAINT "VideoTagOnVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoTagOnVideo" ADD CONSTRAINT "VideoTagOnVideo_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "VideoTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoTaxonomyEvent" ADD CONSTRAINT "VideoTaxonomyEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoTaxonomyEvent" ADD CONSTRAINT "VideoTaxonomyEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoTaxonomyEvent" ADD CONSTRAINT "VideoTaxonomyEvent_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "VideoTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "VideoCategory" ("id", "name", "normalizedName", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text)::uuid, MIN("category"), LOWER(TRIM("category")), CURRENT_TIMESTAMP
FROM "Video"
WHERE "category" IS NOT NULL AND TRIM("category") <> ''
GROUP BY LOWER(TRIM("category"))
ON CONFLICT ("normalizedName") DO NOTHING;

UPDATE "Video" AS v SET "categoryId" = c."id"
FROM "VideoCategory" AS c
WHERE v."category" IS NOT NULL AND LOWER(TRIM(v."category")) = c."normalizedName";

INSERT INTO "VideoTag" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text)::uuid, MIN(tag), LOWER(TRIM(tag)), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Video" v, unnest(v."tags") AS tag
WHERE TRIM(tag) <> ''
GROUP BY LOWER(TRIM(tag))
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "VideoTagOnVideo" ("videoId", "tagId")
SELECT v."id", t."id"
FROM "Video" v, unnest(v."tags") AS tag
JOIN "VideoTag" t ON t."normalizedName" = LOWER(TRIM(tag))
WHERE TRIM(tag) <> ''
ON CONFLICT DO NOTHING;

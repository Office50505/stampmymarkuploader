ALTER TABLE "Upload"
ADD COLUMN "sourceSha256" TEXT,
ADD COLUMN "lineArtCacheKey" TEXT;

CREATE INDEX "Upload_shop_lineArtCacheKey_lineArtStatus_createdAt_idx"
ON "Upload"("shop", "lineArtCacheKey", "lineArtStatus", "createdAt");

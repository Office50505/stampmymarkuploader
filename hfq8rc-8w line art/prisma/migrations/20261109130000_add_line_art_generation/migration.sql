CREATE TYPE "LineArtStatus" AS ENUM ('not_started', 'processing', 'completed', 'failed');

ALTER TABLE "Upload"
ADD COLUMN "lineArtStatus" "LineArtStatus" NOT NULL DEFAULT 'not_started',
ADD COLUMN "lineArtColor" TEXT,
ADD COLUMN "lineArtModel" TEXT,
ADD COLUMN "lineArtRequestId" TEXT,
ADD COLUMN "lineArtStorageKey" TEXT,
ADD COLUMN "lineArtStorageUrl" TEXT,
ADD COLUMN "lineArtContentType" TEXT,
ADD COLUMN "lineArtFileSize" BIGINT,
ADD COLUMN "lineArtGeneratedAt" TIMESTAMP(3),
ADD COLUMN "lineArtError" TEXT;

CREATE INDEX "Upload_shop_lineArtStatus_createdAt_idx"
ON "Upload"("shop", "lineArtStatus", "createdAt");

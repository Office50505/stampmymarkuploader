CREATE TYPE "StampPreviewKind" AS ENUM ('box', 'cup', 'bag');

CREATE TABLE "StampPreview" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "kind" "StampPreviewKind" NOT NULL,
    "status" "LineArtStatus" NOT NULL DEFAULT 'not_started',
    "model" TEXT,
    "requestId" TEXT,
    "storageKey" TEXT,
    "storageUrl" TEXT,
    "contentType" TEXT,
    "fileSize" BIGINT,
    "sourceLineArtGeneratedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StampPreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StampPreview_uploadId_kind_key"
ON "StampPreview"("uploadId", "kind");

CREATE INDEX "StampPreview_uploadId_status_idx"
ON "StampPreview"("uploadId", "status");

ALTER TABLE "StampPreview"
ADD CONSTRAINT "StampPreview_uploadId_fkey"
FOREIGN KEY ("uploadId") REFERENCES "Upload"("uploadId")
ON DELETE CASCADE ON UPDATE CASCADE;

import { fal } from "@fal-ai/client";
import sharp from "sharp";
import prisma from "~/db.server";
import { lineArtConfig, requireServerEnv, uploadConfig } from "./env.server";
import { getOwnedUpload, type InkColor } from "./line-art.server";
import { renderStampPreview } from "./stamp-preview-renderer.server";
import {
  fetchStoredFile,
  fetchStoredFileIfExists,
  storageBucket,
  uploadStoredFile
} from "./storage.server";

export const stampPreviewKinds = ["box", "cup", "bag"] as const;
export type StampPreviewKind = (typeof stampPreviewKinds)[number];

const stampPreviewRenderer = "deterministic-v4-native-1254";

const configureFal = () => {
  fal.config({ credentials: requireServerEnv("FAL_KEY") });
};

const previewError = (kind: StampPreviewKind, error: unknown) => {
  console.error(`${kind} stamp preview generation failed`, error);
  return `The ${kind} preview could not be created. Please try again.`;
};

const isPng = (body: Buffer) =>
  body.length >= 8 &&
  body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

const generatedStorageKey = (shop: string, uploadId: string, kind: StampPreviewKind) => {
  const shopSlug = shop.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  return `shops/${shopSlug}/uploads/${uploadId}/stamp-preview-${kind}.png`;
};

export const stampPreviewThumbnailStorageKey = (storageKey: string) =>
  storageKey.replace(/\.png$/i, "-thumb.webp");

const createStampPreviewThumbnail = (body: Buffer) =>
  sharp(body)
    .resize(640, 640, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4, smartSubsample: true })
    .toBuffer();

const storeStampPreviewThumbnail = async (key: string, body: Buffer) => {
  try {
    const thumbnail = await createStampPreviewThumbnail(body);
    await uploadStoredFile({
      key: stampPreviewThumbnailStorageKey(key),
      contentType: "image/webp",
      body: thumbnail
    });
  } catch (error) {
    console.warn("Stamp preview thumbnail could not be stored; it will be created lazily.", error);
  }
};

export const resolveStampPreviewKind = (
  value: string | null | undefined
): StampPreviewKind | null =>
  stampPreviewKinds.includes(value as StampPreviewKind)
    ? (value as StampPreviewKind)
    : null;

const hasCurrentResult = (
  preview: {
    status: string;
    model: string | null;
    storageKey: string | null;
    requestId: string | null;
    sourceLineArtGeneratedAt: Date | null;
  },
  generatedAt: Date
) => {
  const isCurrent =
    preview.sourceLineArtGeneratedAt?.getTime() === generatedAt.getTime();

  return (
    isCurrent &&
    preview.model === stampPreviewRenderer &&
    ((preview.status === "completed" && Boolean(preview.storageKey)) ||
      (preview.status === "processing" && Boolean(preview.requestId)))
  );
};

export const startStampPreviewGeneration = async ({
  shop,
  uploadId,
  sessionId
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
}) => {
  const owned = await getOwnedUpload({ shop, uploadId, sessionId });
  if (!owned.ok) return owned;

  const { upload } = owned;
  if (
    upload.lineArtStatus !== "completed" ||
    !upload.lineArtStorageKey ||
    !upload.lineArtGeneratedAt
  ) {
    return {
      ok: false as const,
      status: 409,
      errors: ["Line art must be completed before product previews can be created."]
    };
  }

  const existing = await prisma.stampPreview.findMany({
    where: { uploadId }
  });
  const existingByKind = new Map(existing.map((preview) => [preview.kind, preview]));
  const pendingKinds = stampPreviewKinds.filter((kind) => {
    const preview = existingByKind.get(kind);
    return !preview || !hasCurrentResult(preview, upload.lineArtGeneratedAt!);
  });

  if (pendingKinds.length === 0) {
    return { ok: true as const, upload, previews: existing };
  }

  try {
    const stored = await fetchStoredFile(upload.lineArtStorageKey);
    const sourceBody = Buffer.from(await stored.arrayBuffer());
    const color = (upload.lineArtColor || "black") as InkColor;

    await Promise.all(
      pendingKinds.map(async (kind) => {
        try {
          const generatedBody = await renderStampPreview({
            kind,
            artwork: sourceBody,
            color
          });
          if (
            generatedBody.length === 0 ||
            generatedBody.length > uploadConfig.maxBytes ||
            !isPng(generatedBody)
          ) {
            throw new Error("Rendered preview did not pass PNG validation.");
          }
          const key = generatedStorageKey(shop, uploadId, kind);
          await uploadStoredFile({ key, contentType: "image/png", body: generatedBody });
          await storeStampPreviewThumbnail(key, generatedBody);

          await prisma.stampPreview.upsert({
            where: { uploadId_kind: { uploadId, kind } },
            create: {
              uploadId,
              kind,
              status: "completed",
              model: stampPreviewRenderer,
              storageKey: key,
              storageUrl: `bunny://${storageBucket()}/${key}`,
              contentType: "image/png",
              fileSize: generatedBody.length,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              generatedAt: new Date()
            },
            update: {
              status: "completed",
              model: stampPreviewRenderer,
              requestId: null,
              storageKey: key,
              storageUrl: `bunny://${storageBucket()}/${key}`,
              contentType: "image/png",
              fileSize: generatedBody.length,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              generatedAt: new Date(),
              error: null
            }
          });
        } catch (error) {
          const message = previewError(kind, error);
          await prisma.stampPreview.upsert({
            where: { uploadId_kind: { uploadId, kind } },
            create: {
              uploadId,
              kind,
              status: "failed",
              model: stampPreviewRenderer,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              error: message
            },
            update: {
              status: "failed",
              model: stampPreviewRenderer,
              requestId: null,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              generatedAt: null,
              error: message
            }
          });
        }
      })
    );

    const previews = await prisma.stampPreview.findMany({
      where: { uploadId },
      orderBy: { createdAt: "asc" }
    });
    return { ok: true as const, upload, previews };
  } catch (error) {
    const message = "Product previews could not be started. Please try again.";
    console.error("Stamp preview generation could not be started", error);

    await Promise.all(
      pendingKinds.map((kind) =>
        prisma.stampPreview.upsert({
          where: { uploadId_kind: { uploadId, kind } },
          create: {
            uploadId,
            kind,
            status: "failed",
            model: stampPreviewRenderer,
            sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
            error: message
          },
          update: {
            status: "failed",
            model: stampPreviewRenderer,
            requestId: null,
            sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
            error: message
          }
        })
      )
    );

    return { ok: false as const, status: 502, errors: [message] };
  }
};

const refreshOnePreview = async (
  preview: {
    id: string;
    uploadId: string;
    kind: StampPreviewKind;
    status: string;
    requestId: string | null;
    model: string | null;
  },
  shop: string
) => {
  if (preview.status !== "processing" || !preview.requestId) return;

  try {
    configureFal();
    const model = preview.model || lineArtConfig.model;
    const status = await fal.queue.status(model, {
      requestId: preview.requestId,
      logs: false
    });
    const statusName = String(status.status);

    if (statusName === "FAILED") {
      throw new Error("FAL reported a failed preview request.");
    }
    if (statusName !== "COMPLETED") return;

    const result = await fal.queue.result(model, { requestId: preview.requestId });
    const data = result.data as {
      images?: Array<{ url?: string; content_type?: string }>;
    };
    const generatedUrl = data.images?.[0]?.url;

    if (!generatedUrl || new URL(generatedUrl).protocol !== "https:") {
      throw new Error("FAL did not return a valid generated image URL.");
    }

    const generatedResponse = await fetch(generatedUrl);
    if (!generatedResponse.ok) {
      throw new Error(`Generated image download failed with ${generatedResponse.status}.`);
    }

    const generatedBody = Buffer.from(await generatedResponse.arrayBuffer());
    if (
      generatedBody.length === 0 ||
      generatedBody.length > uploadConfig.maxBytes ||
      !isPng(generatedBody)
    ) {
      throw new Error("Generated preview did not pass PNG validation.");
    }

    const key = generatedStorageKey(shop, preview.uploadId, preview.kind);
    await uploadStoredFile({ key, contentType: "image/png", body: generatedBody });
    await storeStampPreviewThumbnail(key, generatedBody);

    await prisma.stampPreview.update({
      where: { id: preview.id },
      data: {
        status: "completed",
        storageKey: key,
        storageUrl: `bunny://${storageBucket()}/${key}`,
        contentType: "image/png",
        fileSize: generatedBody.length,
        generatedAt: new Date(),
        error: null
      }
    });
  } catch (error) {
    const message = previewError(preview.kind, error);
    await prisma.stampPreview.update({
      where: { id: preview.id },
      data: { status: "failed", error: message }
    });
  }
};

export const refreshStampPreviewGeneration = async ({
  shop,
  uploadId,
  sessionId
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
}) => {
  const owned = await getOwnedUpload({ shop, uploadId, sessionId });
  if (!owned.ok) return owned;

  const previews = await prisma.stampPreview.findMany({ where: { uploadId } });
  await Promise.all(
    previews.map((preview) =>
      refreshOnePreview(
        {
          ...preview,
          kind: preview.kind as StampPreviewKind
        },
        shop
      )
    )
  );

  const refreshed = await prisma.stampPreview.findMany({
    where: { uploadId },
    orderBy: { createdAt: "asc" }
  });
  return { ok: true as const, upload: owned.upload, previews: refreshed };
};

export const getStoredStampPreviewForStorefront = async ({
  shop,
  uploadId,
  sessionId,
  kind,
  thumbnail = false
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  kind: StampPreviewKind;
  thumbnail?: boolean;
}) => {
  const owned = await getOwnedUpload({ shop, uploadId, sessionId });
  if (!owned.ok) return owned;

  const preview = await prisma.stampPreview.findUnique({
    where: { uploadId_kind: { uploadId, kind } }
  });
  if (!preview || preview.status !== "completed" || !preview.storageKey) {
    return { ok: false as const, status: 404, errors: ["Stamp preview is not ready."] };
  }

  if (!thumbnail) {
    const file = await fetchStoredFile(preview.storageKey);
    return { ok: true as const, preview, file, contentType: "image/png" as const };
  }

  const thumbnailKey = stampPreviewThumbnailStorageKey(preview.storageKey);
  const storedThumbnail = await fetchStoredFileIfExists(thumbnailKey);
  if (storedThumbnail) {
    return {
      ok: true as const,
      preview,
      file: storedThumbnail,
      contentType: "image/webp" as const
    };
  }

  const fullFile = await fetchStoredFile(preview.storageKey);
  const thumbnailBody = await createStampPreviewThumbnail(
    Buffer.from(await fullFile.arrayBuffer())
  );
  await uploadStoredFile({
    key: thumbnailKey,
    contentType: "image/webp",
    body: thumbnailBody
  });

  return {
    ok: true as const,
    preview,
    file: new Response(thumbnailBody),
    contentType: "image/webp" as const
  };
};

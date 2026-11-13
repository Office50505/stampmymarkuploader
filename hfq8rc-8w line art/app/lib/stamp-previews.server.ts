import { fal } from "@fal-ai/client";
import sharp from "sharp";
import prisma from "~/db.server";
import { lineArtConfig, requireServerEnv, uploadConfig } from "./env.server";
import { getOwnedUpload, type InkColor } from "./line-art.server";
import { logPerformanceMetric } from "./performance.server";
import { renderStampPreviews } from "./stamp-preview-renderer.server";
import {
  resolveStampPreviewProfile,
  stampPreviewKinds,
  type StampPreviewKind,
  type StampPreviewProfile
} from "./stamp-preview-profiles";
import {
  fetchStoredFile,
  fetchStoredFileIfExists,
  storageBucket,
  uploadStoredFile
} from "./storage.server";

export { stampPreviewKinds };
export type { StampPreviewKind, StampPreviewProfile };

const stampPreviewRenderer = (profile: StampPreviewProfile) =>
  `deterministic-v19-product-profile-${profile}`;
const stampPreviewJobs = new Map<string, Promise<void>>();

const configureFal = () => {
  fal.config({ credentials: requireServerEnv("FAL_KEY") });
};

const previewError = (kind: StampPreviewKind, error: unknown) => {
  console.error(`${kind} stamp preview generation failed`, error);
  return `The ${kind} preview could not be created. Please try again.`;
};

const isWebp = (body: Buffer) =>
  body.length >= 12 &&
  body.subarray(0, 4).toString("ascii") === "RIFF" &&
  body.subarray(8, 12).toString("ascii") === "WEBP";

const generatedStorageKey = (
  shop: string,
  uploadId: string,
  profile: StampPreviewProfile,
  kind: StampPreviewKind,
  color: InkColor,
  sourceVersion: number
) => {
  const shopSlug = shop.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  return `shops/${shopSlug}/uploads/${uploadId}/stamp-preview-${profile}-${kind}-${color}-${sourceVersion}.webp`;
};

export const stampPreviewThumbnailStorageKey = (storageKey: string) =>
  storageKey.replace(/\.(?:png|webp)$/i, "-thumb.webp");

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
  generatedAt: Date,
  renderer: string
) => {
  const isCurrent =
    preview.sourceLineArtGeneratedAt?.getTime() === generatedAt.getTime();

  return (
    isCurrent &&
    preview.model === renderer &&
    ((preview.status === "completed" && Boolean(preview.storageKey)) ||
      (preview.status === "processing" && Boolean(preview.requestId)))
  );
};

export const startStampPreviewGeneration = async ({
  shop,
  uploadId,
  sessionId,
  expectedColor,
  expectedSourceVersion,
  previewProfile
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  expectedColor?: string | null;
  expectedSourceVersion?: number | null;
  previewProfile?: string | null;
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

  const color = (upload.lineArtColor || "black") as InkColor;
  const profile = resolveStampPreviewProfile(previewProfile);
  const renderer = stampPreviewRenderer(profile);
  const sourceGeneratedAt = upload.lineArtGeneratedAt;
  const sourceVersion = sourceGeneratedAt.getTime();
  if (
    (expectedColor && expectedColor !== color) ||
    (expectedSourceVersion && expectedSourceVersion !== sourceVersion)
  ) {
    return {
      ok: false as const,
      status: 409,
      errors: ["This preview request was replaced by a newer ink selection."]
    };
  }

  const existing = await prisma.stampPreview.findMany({
    where: { uploadId }
  });
  const existingByKind = new Map(existing.map((preview) => [preview.kind, preview]));
  const pendingKinds = stampPreviewKinds.filter((kind) => {
    const preview = existingByKind.get(kind);
    return !preview || !hasCurrentResult(preview, sourceGeneratedAt, renderer);
  });

  if (pendingKinds.length === 0) {
    logPerformanceMetric({
      source: "server",
      phase: "mockups",
      outcome: "success",
      durationMs: 0,
      shop,
      uploadId,
      inkColor: color,
      mode: "cache",
      previewCount: stampPreviewKinds.length
    });
    return { ok: true as const, upload, previews: existing, profile };
  }

  const isCurrentRevision = async () => {
    const current = await prisma.upload.findUnique({
      where: { uploadId },
      select: {
        lineArtStatus: true,
        lineArtColor: true,
        lineArtGeneratedAt: true
      }
    });

    return Boolean(
      current &&
        current.lineArtStatus === "completed" &&
        current.lineArtColor === color &&
        current.lineArtGeneratedAt?.getTime() === sourceVersion
    );
  };

  const jobKey = `${uploadId}:${sourceVersion}:${renderer}`;
  let job = stampPreviewJobs.get(jobKey);
  if (!job) {
    job = (async () => {
      const jobStartedAt = Date.now();
      let failedPreviewCount = 0;
      try {
        const stored = await fetchStoredFile(upload.lineArtStorageKey!);
        const sourceBody = Buffer.from(await stored.arrayBuffer());
        const rendered = await renderStampPreviews({
          profile,
          kinds: [...pendingKinds],
          artwork: sourceBody,
          color
        });

        if (!(await isCurrentRevision())) {
          logPerformanceMetric({
            source: "server",
            phase: "mockups",
            outcome: "cancelled",
            durationMs: Date.now() - jobStartedAt,
            shop,
            uploadId,
            inkColor: color,
            mode: "render_store",
            previewCount: pendingKinds.length
          });
          return;
        }

        rendered.forEach(({ kind, durationMs }) => {
          logPerformanceMetric({
            source: "server",
            phase: "mockup_kind",
            outcome: "success",
            durationMs,
            shop,
            uploadId,
            inkColor: color,
            mode: "render",
            kind
          });
        });

        await Promise.all(
          rendered.map(async ({ kind, body, thumbnail }) => {
            const storeStartedAt = Date.now();
            try {
              if (
                body.length === 0 ||
                body.length > uploadConfig.maxBytes ||
                !isWebp(body) ||
                thumbnail.length === 0 ||
                !isWebp(thumbnail)
              ) {
                throw new Error("Rendered preview did not pass WEBP validation.");
              }

              const key = generatedStorageKey(
                shop,
                uploadId,
                profile,
                kind,
                color,
                sourceVersion
              );
              await Promise.all([
                uploadStoredFile({ key, contentType: "image/webp", body }),
                uploadStoredFile({
                  key: stampPreviewThumbnailStorageKey(key),
                  contentType: "image/webp",
                  body: thumbnail
                })
              ]);

              // Rendering and storage are asynchronous. Never let an older ink
              // request overwrite the row belonging to the latest selection.
              if (!(await isCurrentRevision())) return;

              await prisma.stampPreview.upsert({
                where: { uploadId_kind: { uploadId, kind } },
                create: {
                  uploadId,
                  kind,
                  status: "completed",
                  model: renderer,
                  storageKey: key,
                  storageUrl: `bunny://${storageBucket()}/${key}`,
                  contentType: "image/webp",
                  fileSize: body.length,
                  sourceLineArtGeneratedAt: sourceGeneratedAt,
                  generatedAt: new Date()
                },
                update: {
                  status: "completed",
                  model: renderer,
                  requestId: null,
                  storageKey: key,
                  storageUrl: `bunny://${storageBucket()}/${key}`,
                  contentType: "image/webp",
                  fileSize: body.length,
                  sourceLineArtGeneratedAt: sourceGeneratedAt,
                  generatedAt: new Date(),
                  error: null
                }
              });
              logPerformanceMetric({
                source: "server",
                phase: "mockup_kind",
                outcome: "success",
                durationMs: Date.now() - storeStartedAt,
                shop,
                uploadId,
                inkColor: color,
                mode: "store",
                kind
              });
            } catch (error) {
              failedPreviewCount += 1;
              const message = previewError(kind, error);
              if (!(await isCurrentRevision())) return;
              await prisma.stampPreview.upsert({
                where: { uploadId_kind: { uploadId, kind } },
                create: {
                  uploadId,
                  kind,
                  status: "failed",
                  model: renderer,
                  sourceLineArtGeneratedAt: sourceGeneratedAt,
                  error: message
                },
                update: {
                  status: "failed",
                  model: renderer,
                  requestId: null,
                  sourceLineArtGeneratedAt: sourceGeneratedAt,
                  generatedAt: null,
                  error: message
                }
              });
              logPerformanceMetric({
                source: "server",
                phase: "mockup_kind",
                outcome: "failure",
                durationMs: Date.now() - storeStartedAt,
                shop,
                uploadId,
                inkColor: color,
                mode: "store",
                kind,
                errorCode: "preview_failed"
              });
            }
          })
        );
        logPerformanceMetric({
          source: "server",
          phase: "mockups",
          outcome: failedPreviewCount > 0 ? "failure" : "success",
          durationMs: Date.now() - jobStartedAt,
          shop,
          uploadId,
          inkColor: color,
          mode: "render_store",
          previewCount: pendingKinds.length,
          errorCode: failedPreviewCount > 0 ? "preview_failed" : null
        });
      } catch (error) {
        const message = "Product previews could not be started. Please try again.";
        console.error("Stamp preview generation could not be started", error);
        if (!(await isCurrentRevision())) return;

        await Promise.all(
          pendingKinds.map((kind) =>
            prisma.stampPreview.upsert({
              where: { uploadId_kind: { uploadId, kind } },
              create: {
                uploadId,
                kind,
                status: "failed",
                model: renderer,
                sourceLineArtGeneratedAt: sourceGeneratedAt,
                error: message
              },
              update: {
                status: "failed",
                model: renderer,
                requestId: null,
                sourceLineArtGeneratedAt: sourceGeneratedAt,
                error: message
              }
            })
          )
        );
        logPerformanceMetric({
          source: "server",
          phase: "mockups",
          outcome: "failure",
          durationMs: Date.now() - jobStartedAt,
          shop,
          uploadId,
          inkColor: color,
          mode: "render_store",
          previewCount: pendingKinds.length,
          errorCode: "preview_start_failed"
        });
      }
    })().finally(() => {
      stampPreviewJobs.delete(jobKey);
    });
    stampPreviewJobs.set(jobKey, job);
  }

  await job;
  const [currentUpload, previews] = await Promise.all([
    prisma.upload.findUnique({ where: { uploadId } }),
    prisma.stampPreview.findMany({
      where: { uploadId },
      orderBy: { createdAt: "asc" }
    })
  ]);

  return {
    ok: true as const,
    upload: currentUpload || upload,
    previews,
    profile
  };
};

const refreshOnePreview = async (
  preview: {
    id: string;
    uploadId: string;
    kind: StampPreviewKind;
    status: string;
    requestId: string | null;
    model: string | null;
    sourceLineArtGeneratedAt: Date | null;
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

    const sourceBody = Buffer.from(await generatedResponse.arrayBuffer());
    const generatedBody = await sharp(sourceBody)
      .webp({ quality: 94, alphaQuality: 100, effort: 4, smartSubsample: true })
      .toBuffer();
    if (
      generatedBody.length === 0 ||
      generatedBody.length > uploadConfig.maxBytes ||
      !isWebp(generatedBody)
    ) {
      throw new Error("Generated preview did not pass WEBP validation.");
    }

    const currentUpload = await prisma.upload.findUnique({
      where: { uploadId: preview.uploadId },
      select: { lineArtColor: true, lineArtGeneratedAt: true }
    });
    const sourceVersion = preview.sourceLineArtGeneratedAt?.getTime();
    if (
      !currentUpload?.lineArtColor ||
      !sourceVersion ||
      currentUpload.lineArtGeneratedAt?.getTime() !== sourceVersion
    ) {
      return;
    }
    const key = generatedStorageKey(
      shop,
      preview.uploadId,
      "permanent",
      preview.kind,
      currentUpload.lineArtColor as InkColor,
      sourceVersion
    );
    await Promise.all([
      uploadStoredFile({ key, contentType: "image/webp", body: generatedBody }),
      storeStampPreviewThumbnail(key, generatedBody)
    ]);

    await prisma.stampPreview.update({
      where: { id: preview.id },
      data: {
        status: "completed",
        storageKey: key,
        storageUrl: `bunny://${storageBucket()}/${key}`,
        contentType: "image/webp",
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
  thumbnail = false,
  version
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  kind: StampPreviewKind;
  thumbnail?: boolean;
  version?: number | null;
}) => {
  const owned = await getOwnedUpload({ shop, uploadId, sessionId });
  if (!owned.ok) return owned;

  const preview = await prisma.stampPreview.findUnique({
    where: { uploadId_kind: { uploadId, kind } }
  });
  if (!preview || preview.status !== "completed" || !preview.storageKey) {
    return { ok: false as const, status: 404, errors: ["Stamp preview is not ready."] };
  }
  if (version && preview.generatedAt?.getTime() !== version) {
    return { ok: false as const, status: 409, errors: ["Stamp preview was replaced."] };
  }

  if (!thumbnail) {
    const file = await fetchStoredFile(preview.storageKey);
    const contentType = preview.contentType === "image/webp" ? "image/webp" : "image/png";
    return { ok: true as const, preview, file, contentType };
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

import { fal } from "@fal-ai/client";
import prisma from "~/db.server";
import { lineArtConfig, requireServerEnv, uploadConfig } from "./env.server";
import { getOwnedUpload, type InkColor } from "./line-art.server";
import { fetchStoredFile, storageBucket, uploadStoredFile } from "./storage.server";

export const stampPreviewKinds = ["box", "cup", "bag"] as const;
export type StampPreviewKind = (typeof stampPreviewKinds)[number];

const kindLabels: Record<StampPreviewKind, string> = {
  box: "kraft shipping box",
  cup: "white takeaway paper cup",
  bag: "kraft paper shopping bag"
};

const kindScenes: Record<StampPreviewKind, string> = {
  box: "Show one closed natural kraft cardboard mailer box at a tasteful three-quarter angle, with the stamp centered cleanly on the top lid.",
  cup: "Show one premium matte white takeaway coffee cup with a simple fitted lid, with the stamp centered cleanly on the front of the cup.",
  bag: "Show one upright natural kraft paper shopping bag with twisted paper handles, with the stamp centered cleanly on the front panel."
};

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

export const resolveStampPreviewKind = (
  value: string | null | undefined
): StampPreviewKind | null =>
  stampPreviewKinds.includes(value as StampPreviewKind)
    ? (value as StampPreviewKind)
    : null;

export const buildStampPreviewPrompt = (kind: StampPreviewKind, color: InkColor) => `
TASK
Create a premium, photorealistic ecommerce product mockup showing the supplied stamp line art applied to a ${kindLabels[kind]}.

ARTWORK FIDELITY — HIGHEST PRIORITY
- The supplied transparent PNG is the finished customer artwork, not inspiration. Reproduce it exactly.
- Preserve every letter, word, number, icon, border, line, spacing relationship, proportion, orientation, and layout exactly as supplied.
- Do not redraw, restyle, simplify, improve, translate, correct, replace, add, or remove anything in the artwork.
- Apply the complete artwork once, as a realistic single-color ${color} ink stamp impression. Do not invent other text or branding anywhere in the image.
- Keep the artwork crisp, legible, flat to the product surface, and naturally integrated with subtle ink absorption. No embossing, engraving, label, sticker, foil, or raised print effect.

PRODUCT AND COMPOSITION
- ${kindScenes[kind]}
- Square, catalog-ready composition with the entire product visible and generous breathing room.
- Warm off-white seamless studio background, soft diffused daylight, realistic contact shadow, refined neutral styling.
- Product photography only: no hands, people, props, extra products, captions, frames, watermarks, or logos other than the supplied artwork.

OUTPUT
- Return exactly one 1024 by 1024 photorealistic product image.
- Opaque background, PNG format.
`.trim();

const hasCurrentResult = (
  preview: {
    status: string;
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
    configureFal();
    const stored = await fetchStoredFile(upload.lineArtStorageKey);
    const sourceBody = Buffer.from(await stored.arrayBuffer());
    const sourceBlob = new Blob([new Uint8Array(sourceBody)], { type: "image/png" });
    const sourceUrl = await fal.storage.upload(sourceBlob, {
      lifecycle: { expiresIn: "1d" }
    });
    const color = (upload.lineArtColor || "black") as InkColor;

    await Promise.all(
      pendingKinds.map(async (kind) => {
        try {
          const queued = await fal.queue.submit(lineArtConfig.model, {
            input: {
              prompt: buildStampPreviewPrompt(kind, color),
              image_urls: [sourceUrl],
              image_size: "square_hd",
              background: "opaque",
              quality: lineArtConfig.quality,
              reasoning_effort: lineArtConfig.reasoningEffort,
              num_images: 1,
              output_format: "png"
            },
            storageSettings: { expiresIn: "1d" }
          });

          await prisma.stampPreview.upsert({
            where: { uploadId_kind: { uploadId, kind } },
            create: {
              uploadId,
              kind,
              status: "processing",
              model: lineArtConfig.model,
              requestId: queued.request_id,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt
            },
            update: {
              status: "processing",
              model: lineArtConfig.model,
              requestId: queued.request_id,
              storageKey: null,
              storageUrl: null,
              contentType: null,
              fileSize: null,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              generatedAt: null,
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
              model: lineArtConfig.model,
              sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
              error: message
            },
            update: {
              status: "failed",
              model: lineArtConfig.model,
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
            model: lineArtConfig.model,
            sourceLineArtGeneratedAt: upload.lineArtGeneratedAt,
            error: message
          },
          update: {
            status: "failed",
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
  kind
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  kind: StampPreviewKind;
}) => {
  const owned = await getOwnedUpload({ shop, uploadId, sessionId });
  if (!owned.ok) return owned;

  const preview = await prisma.stampPreview.findUnique({
    where: { uploadId_kind: { uploadId, kind } }
  });
  if (!preview || preview.status !== "completed" || !preview.storageKey) {
    return { ok: false as const, status: 404, errors: ["Stamp preview is not ready."] };
  }

  const file = await fetchStoredFile(preview.storageKey);
  return { ok: true as const, preview, file };
};

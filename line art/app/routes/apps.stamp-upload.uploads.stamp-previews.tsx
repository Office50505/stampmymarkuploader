import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import {
  stampPreviewKinds,
  startStampPreviewGeneration
} from "../lib/stamp-previews.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const body = await request.json().catch(() => null);
  if (!body?.uploadId) {
    return errorResponse("uploadId is required.", 400);
  }

  const result = await startStampPreviewGeneration({
    shop,
    uploadId: String(body.uploadId),
    sessionId: body.sessionId ? String(body.sessionId) : null,
    expectedColor: body.inkColor ? String(body.inkColor) : null,
    expectedSourceVersion: Number.isFinite(Number(body.sourceVersion))
      ? Number(body.sourceVersion)
      : null
  });

  if (!result.ok) {
    return errorResponse("Product previews could not be started.", result.status, result.errors);
  }

  const previewsByKind = new Map(result.previews.map((preview) => [preview.kind, preview]));
  const sourceVersion = result.upload.lineArtGeneratedAt?.getTime() || null;
  const inkColor = result.upload.lineArtColor || "black";
  return jsonResponse(
    {
      ok: true,
      uploadId: result.upload.uploadId,
      inkColor,
      sourceVersion,
      previews: stampPreviewKinds.map((kind) => {
        const preview = previewsByKind.get(kind);
        const previewSourceVersion = preview?.sourceLineArtGeneratedAt?.getTime() || null;
        const ready =
          preview?.status === "completed" &&
          Boolean(preview.storageKey) &&
          previewSourceVersion === sourceVersion;
        const previewUrl = ready
          ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/stamp-preview-file` +
            `?kind=${encodeURIComponent(kind)}&sessionId=${encodeURIComponent(String(body.sessionId || ""))}&thumbnail=1`
          : null;
        const fullPreviewUrl = ready
          ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/stamp-preview-file` +
            `?kind=${encodeURIComponent(kind)}&sessionId=${encodeURIComponent(String(body.sessionId || ""))}`
          : null;

        return {
          kind,
          status: preview?.status || "not_started",
          version: preview?.generatedAt?.getTime() || null,
          inkColor,
          sourceVersion: previewSourceVersion,
          previewUrl,
          fullPreviewUrl,
          error: preview?.status === "failed" ? preview.error : null
        };
      })
    },
    { status: 202 }
  );
};

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { startLineArtGeneration } from "../lib/line-art.server";
import { createLineArtOrderFileUrl } from "../lib/uploads.server";

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

  const result = await startLineArtGeneration({
    shop,
    uploadId: String(body.uploadId),
    sessionId: body.sessionId ? String(body.sessionId) : null,
    inkColor: body.inkColor ? String(body.inkColor) : null
  });

  if (!result.ok) {
    return errorResponse("Line art could not be started.", result.status, result.errors);
  }

  const ready =
    result.status === "completed" && Boolean(result.upload.lineArtStorageKey);
  const previewUrl = ready
    ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/line-art-file` +
      `?sessionId=${encodeURIComponent(String(body.sessionId || ""))}&thumbnail=1`
    : null;
  const fullPreviewUrl = ready
    ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/line-art-file` +
      `?sessionId=${encodeURIComponent(String(body.sessionId || ""))}`
    : null;

  return jsonResponse(
    {
      ok: true,
      uploadId: result.upload.uploadId,
      status: result.status,
      color: result.color,
      version: result.upload.lineArtGeneratedAt?.getTime() || null,
      previewUrl,
      fullPreviewUrl,
      lineArtUrl: ready ? createLineArtOrderFileUrl(result.upload) : null
    },
    { status: result.status === "processing" ? 202 : 200 }
  );
};

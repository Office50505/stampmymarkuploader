import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { refreshLineArtGeneration } from "../lib/line-art.server";
import { createLineArtOrderFileUrl } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const result = await refreshLineArtGeneration({
    shop,
    uploadId: params.uploadId || "",
    sessionId
  });

  if (!result.ok) {
    return errorResponse("Line art status could not be checked.", result.status, result.errors);
  }

  const { upload } = result;
  const ready = upload.lineArtStatus === "completed" && Boolean(upload.lineArtStorageKey);
  const previewUrl = ready
    ? `/apps/line-art-upload/uploads/${encodeURIComponent(upload.uploadId)}/line-art-file` +
      `?sessionId=${encodeURIComponent(sessionId || "")}&thumbnail=1`
    : null;
  const fullPreviewUrl = ready
    ? `/apps/line-art-upload/uploads/${encodeURIComponent(upload.uploadId)}/line-art-file` +
      `?sessionId=${encodeURIComponent(sessionId || "")}`
    : null;

  return jsonResponse({
    ok: true,
    uploadId: upload.uploadId,
    status: upload.lineArtStatus,
    color: upload.lineArtColor,
    previewUrl,
    fullPreviewUrl,
    lineArtUrl: ready ? createLineArtOrderFileUrl(upload) : null,
    error: upload.lineArtStatus === "failed" ? upload.lineArtError : null
  });
};

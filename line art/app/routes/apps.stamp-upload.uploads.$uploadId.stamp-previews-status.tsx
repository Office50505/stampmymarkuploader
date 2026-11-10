import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import {
  refreshStampPreviewGeneration,
  stampPreviewKinds
} from "../lib/stamp-previews.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const result = await refreshStampPreviewGeneration({
    shop,
    uploadId: params.uploadId || "",
    sessionId
  });

  if (!result.ok) {
    return errorResponse("Product preview status could not be checked.", result.status, result.errors);
  }

  const previewsByKind = new Map(result.previews.map((preview) => [preview.kind, preview]));
  return jsonResponse({
    ok: true,
    uploadId: result.upload.uploadId,
    previews: stampPreviewKinds.map((kind) => {
      const preview = previewsByKind.get(kind);
      const ready = preview?.status === "completed" && Boolean(preview.storageKey);
      const previewUrl = ready
        ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/stamp-preview-file` +
          `?kind=${encodeURIComponent(kind)}&sessionId=${encodeURIComponent(sessionId || "")}&thumbnail=1`
        : null;
      const fullPreviewUrl = ready
        ? `/apps/line-art-upload/uploads/${encodeURIComponent(result.upload.uploadId)}/stamp-preview-file` +
          `?kind=${encodeURIComponent(kind)}&sessionId=${encodeURIComponent(sessionId || "")}`
        : null;

      return {
        kind,
        status: preview?.status || "not_started",
        previewUrl,
        fullPreviewUrl,
        error: preview?.status === "failed" ? preview.error : null
      };
    })
  });
};

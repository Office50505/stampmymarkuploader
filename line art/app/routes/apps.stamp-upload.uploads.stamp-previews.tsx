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
    sessionId: body.sessionId ? String(body.sessionId) : null
  });

  if (!result.ok) {
    return errorResponse("Product previews could not be started.", result.status, result.errors);
  }

  const statuses = new Map(result.previews.map((preview) => [preview.kind, preview.status]));
  return jsonResponse(
    {
      ok: true,
      uploadId: result.upload.uploadId,
      previews: stampPreviewKinds.map((kind) => ({
        kind,
        status: statuses.get(kind) || "not_started"
      }))
    },
    { status: 202 }
  );
};

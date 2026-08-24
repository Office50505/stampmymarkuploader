import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { completeUpload } from "../lib/uploads.server";

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

  const result = await completeUpload({
    shop,
    uploadId: String(body.uploadId),
    sessionId: body.sessionId ? String(body.sessionId) : null
  });

  if (!result.ok) {
    return errorResponse("Upload could not be completed.", result.status, result.errors);
  }

  return jsonResponse({ ok: true, uploadId: result.upload.uploadId });
};

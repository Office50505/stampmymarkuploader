import type { ActionFunctionArgs } from "react-router";
import { getOwnedUpload } from "../lib/line-art.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import {
  logPerformanceMetric,
  parseClientPerformanceMetric
} from "../lib/performance.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const rawBody = await request.json().catch(() => null);
  const body =
    rawBody && typeof rawBody === "object"
      ? (rawBody as Record<string, unknown>)
      : null;
  if (!body?.uploadId || !body?.sessionId) {
    return errorResponse("Upload session is required.", 400);
  }

  const owned = await getOwnedUpload({
    shop,
    uploadId: String(body.uploadId),
    sessionId: String(body.sessionId)
  });
  if (!owned.ok) {
    return errorResponse("Upload could not be verified.", owned.status, owned.errors);
  }

  const metric = parseClientPerformanceMetric(body);
  if (!metric) {
    return errorResponse("Invalid performance metric.", 400);
  }

  logPerformanceMetric({
    source: "client",
    shop,
    uploadId: owned.upload.uploadId,
    ...metric
  });

  return jsonResponse(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
};

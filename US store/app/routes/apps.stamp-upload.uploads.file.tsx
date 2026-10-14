import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { storeUploadFile } from "../lib/uploads.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const formData = await request.formData();
  const uploadId = formData.get("uploadId");
  const sessionId = formData.get("sessionId");
  const file = formData.get("file");

  if (typeof uploadId !== "string" || !uploadId) {
    return errorResponse("uploadId is required.", 400);
  }

  if (!(file instanceof File)) {
    return errorResponse("file is required.", 400);
  }

  const result = await storeUploadFile({
    shop,
    uploadId,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    file
  });

  if (!result.ok) {
    return errorResponse("Upload could not be stored.", result.status, result.errors);
  }

  return jsonResponse({ ok: true, uploadId: result.upload.uploadId });
};

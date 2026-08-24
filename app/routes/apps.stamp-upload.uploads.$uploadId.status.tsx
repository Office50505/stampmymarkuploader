import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { getUploadForAdmin } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const upload = await getUploadForAdmin(shop, params.uploadId || "");
  if (!upload) {
    return errorResponse("Upload not found.", 404);
  }

  return jsonResponse({
    ok: true,
    uploadId: upload.uploadId,
    status: upload.status,
    uploadedAt: upload.uploadedAt
  });
};

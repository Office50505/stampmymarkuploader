import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { markUploadInCart } from "../lib/uploads.server";

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

  const result = await markUploadInCart({
    shop,
    uploadId: String(body.uploadId),
    sessionId: body.sessionId ? String(body.sessionId) : null,
    cartToken: body.cartToken ? String(body.cartToken) : null,
    quantity: body.quantity ? Number(body.quantity) : null,
    selectedSize: body.selectedSize ? String(body.selectedSize) : null,
    variantId: body.variantId ? String(body.variantId) : null,
    textAbove: body.textAbove ? String(body.textAbove) : null,
    textBelow: body.textBelow ? String(body.textBelow) : null,
    designerNotes: body.designerNotes ? String(body.designerNotes) : null
  });

  if (!result.ok) {
    return errorResponse("Upload could not be attached to cart.", result.status, result.errors);
  }

  return jsonResponse({ ok: true });
};

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { errorResponse, getShopFromAppProxy, jsonResponse } from "../lib/http.server";
import { getClientIpFromRequest, lookupIpLocation } from "../lib/ip-geolocation.server";
import { initUpload } from "../lib/uploads.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    return errorResponse("Shop could not be verified.", 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return errorResponse("Invalid JSON body.", 400);
  }

  const ipLocation = await lookupIpLocation(getClientIpFromRequest(request));

  const result = await initUpload({
    shop,
    filename: String(body.filename ?? ""),
    contentType: String(body.contentType ?? ""),
    fileSize: Number(body.fileSize ?? 0),
    productId: body.productId ? String(body.productId) : null,
    productHandle: body.productHandle ? String(body.productHandle) : null,
    productTitle: body.productTitle ? String(body.productTitle) : null,
    variantId: body.variantId ? String(body.variantId) : null,
    variantTitle: body.variantTitle ? String(body.variantTitle) : null,
    selectedSize: body.selectedSize ? String(body.selectedSize) : null,
    quantity: body.quantity ? Number(body.quantity) : null,
    sessionId: body.sessionId ? String(body.sessionId) : null,
    cartToken: body.cartToken ? String(body.cartToken) : null,
    customerId: body.customerId ? String(body.customerId) : null,
    ipLocation
  });

  if (!result.ok) {
    return errorResponse("Upload rejected.", result.status, result.errors);
  }

  return jsonResponse({
    ok: true,
    uploadId: result.uploadId,
    expiresAt: result.expiresAt,
    artworkUrl: result.artworkUrl
  });
};

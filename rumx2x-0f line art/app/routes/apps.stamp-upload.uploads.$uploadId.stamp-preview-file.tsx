import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopFromAppProxy } from "../lib/http.server";
import {
  getStoredStampPreviewForStorefront,
  resolveStampPreviewKind
} from "../lib/stamp-previews.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    throw new Response("Shop could not be verified.", { status: 401 });
  }

  const url = new URL(request.url);
  const thumbnail = url.searchParams.get("thumbnail") === "1";
  const requestedVersion = Number(url.searchParams.get("v"));
  const kind = resolveStampPreviewKind(url.searchParams.get("kind"));
  if (!kind) {
    throw new Response("Preview type is invalid.", { status: 400 });
  }

  const result = await getStoredStampPreviewForStorefront({
    shop,
    uploadId: params.uploadId || "",
    sessionId: url.searchParams.get("sessionId"),
    kind,
    thumbnail,
    version: Number.isFinite(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : null
  });

  if (!result.ok) {
    throw new Response("Stamp preview not found.", { status: result.status });
  }

  return new Response(result.file.body, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control":
        Number.isFinite(requestedVersion) && requestedVersion > 0
          ? "private, max-age=31536000, immutable"
          : "private, no-store",
      "Content-Disposition": `inline; filename="stamp-preview-${kind}.${result.contentType === "image/webp" ? "webp" : "png"}"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
};

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
  const kind = resolveStampPreviewKind(url.searchParams.get("kind"));
  if (!kind) {
    throw new Response("Preview type is invalid.", { status: 400 });
  }

  const result = await getStoredStampPreviewForStorefront({
    shop,
    uploadId: params.uploadId || "",
    sessionId: url.searchParams.get("sessionId"),
    kind
  });

  if (!result.ok) {
    throw new Response("Stamp preview not found.", { status: result.status });
  }

  return new Response(result.file.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="stamp-preview-${kind}.png"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
};

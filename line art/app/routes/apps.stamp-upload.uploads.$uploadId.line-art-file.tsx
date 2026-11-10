import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopFromAppProxy } from "../lib/http.server";
import { getStoredLineArtForStorefront } from "../lib/line-art.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);

  if (!shop) {
    throw new Response("Shop could not be verified.", { status: 401 });
  }

  const url = new URL(request.url);
  const thumbnail = url.searchParams.get("thumbnail") === "1";
  const result = await getStoredLineArtForStorefront({
    shop,
    uploadId: params.uploadId || "",
    sessionId: url.searchParams.get("sessionId"),
    thumbnail
  });

  if (!result.ok) {
    throw new Response("Line art not found.", { status: result.status });
  }

  return new Response(result.file.body, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="stamp-line-art.${result.contentType === "image/webp" ? "webp" : "png"}"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
};

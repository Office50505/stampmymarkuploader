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
  const result = await getStoredLineArtForStorefront({
    shop,
    uploadId: params.uploadId || "",
    sessionId: url.searchParams.get("sessionId")
  });

  if (!result.ok) {
    throw new Response("Line art not found.", { status: result.status });
  }

  return new Response(result.file.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline; filename=\"stamp-line-art.png\"",
      "X-Content-Type-Options": "nosniff"
    }
  });
};

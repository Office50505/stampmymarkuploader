import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getStoredLineArtResponse,
  verifyAdminFileUrlSignature
} from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const uploadId = params.uploadId || "";
  const signed = verifyAdminFileUrlSignature({
    shop: url.searchParams.get("shop"),
    uploadId,
    expires: url.searchParams.get("expires"),
    inline: url.searchParams.get("inline"),
    signature: url.searchParams.get("signature")
  });
  const shop = signed?.shop ?? (await authenticate.admin(request)).session.shop;
  const result = await getStoredLineArtResponse(shop, uploadId);

  if (!result) {
    throw new Response("Line art not found", { status: 404 });
  }

  return new Response(result.file.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${signed?.inline ? "inline" : "attachment"}; filename="stamp-line-art.png"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
};

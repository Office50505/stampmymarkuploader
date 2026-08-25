import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getStoredUploadResponse,
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
  const result = await getStoredUploadResponse(shop, uploadId);

  if (!result) {
    throw new Response("Upload not found", { status: 404 });
  }

  const { upload, file } = result;
  const safeFilename = upload.originalFilename.replace(/["\r\n]/g, "");
  const headers = new Headers();
  headers.set("Content-Type", upload.contentType);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Disposition",
    `${signed?.inline ? "inline" : "attachment"}; filename="${safeFilename}"`
  );

  return new Response(file.body, {
    status: 200,
    headers
  });
};

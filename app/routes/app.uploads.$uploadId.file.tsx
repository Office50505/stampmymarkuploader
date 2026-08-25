import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getStoredUploadResponse } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const result = await getStoredUploadResponse(session.shop, params.uploadId || "");

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
    `${url.searchParams.get("inline") ? "inline" : "attachment"}; filename="${safeFilename}"`
  );

  return new Response(file.body, {
    status: 200,
    headers
  });
};

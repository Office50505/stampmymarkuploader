import type { LoaderFunctionArgs } from "react-router";
import { getStoredUploadResponseForOrderLink } from "../lib/uploads.server";
import { sanitizeDisplayFilename } from "../lib/upload-validation.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const result = await getStoredUploadResponseForOrderLink({
    uploadId: params.uploadId || "",
    token: url.searchParams.get("token")
  });

  if (!result) {
    throw new Response("Upload not found", { status: 404 });
  }

  const { upload, file } = result;
  const safeFilename = sanitizeDisplayFilename(upload.originalFilename);
  const headers = new Headers();

  headers.set("Content-Type", upload.contentType);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", `inline; filename="${safeFilename}"`);

  return new Response(file.body, {
    status: 200,
    headers
  });
};

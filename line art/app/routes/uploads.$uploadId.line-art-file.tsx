import type { LoaderFunctionArgs } from "react-router";
import { getStoredLineArtResponseForOrderLink } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const result = await getStoredLineArtResponseForOrderLink({
    uploadId: params.uploadId || "",
    token: url.searchParams.get("token")
  });

  if (!result) {
    throw new Response("Line art not found", { status: 404 });
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

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { createAdminFileUrl } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const signed = await createAdminFileUrl({
    shop: session.shop,
    uploadId: params.uploadId || "",
    inline: false
  });

  if (!signed) {
    throw new Response("Upload not found", { status: 404 });
  }

  return redirect(signed.url);
};

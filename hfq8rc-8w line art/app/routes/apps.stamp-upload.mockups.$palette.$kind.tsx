import fs from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { getShopFromAppProxy } from "../lib/http.server";
import { authenticate } from "../shopify.server";

const palettes = new Set(["regular", "white"]);
const kinds = new Set(["bag", "cup", "box"]);

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = getShopFromAppProxy(context, request);
  const palette = String(params.palette || "").toLowerCase();
  const kind = String(params.kind || "").toLowerCase();

  if (!shop) {
    throw new Response("Shop could not be verified.", { status: 401 });
  }
  if (!palettes.has(palette) || !kinds.has(kind)) {
    throw new Response("Mockup not found.", { status: 404 });
  }

  const body = await fs.readFile(
    path.join(
      process.cwd(),
      "public",
      "stamp-mockups",
      "v3",
      "client",
      `${palette}-${kind}.webp`
    )
  );

  return new Response(body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
};

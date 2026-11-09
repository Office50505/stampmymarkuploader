import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { findArtworkViolations, holdOrderForMissingArtwork } from "../lib/artwork-guard.server";
import { processOrderCreateWebhook } from "../lib/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  if (!webhookId) {
    throw new Response("Missing webhook id", { status: 400 });
  }

  const orderPayload = payload as {
    id?: string | number;
    line_items?: Array<{
      product_id?: string | number | null;
      title?: string;
      variant_title?: string | null;
      properties?: Array<{ name?: string; value?: string }>;
    }>;
  };
  const violations = await findArtworkViolations({
    shop,
    lineItems: orderPayload.line_items || []
  });

  if (violations.length && orderPayload.id) {
    const { admin } = await unauthenticated.admin(shop);
    await holdOrderForMissingArtwork({
      admin,
      orderId: String(orderPayload.id),
      violations
    });
  }

  await processOrderCreateWebhook({
    webhookId,
    shop,
    payload: payload as never
  });

  return new Response();
};

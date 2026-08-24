import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processOrderCreateWebhook } from "../lib/webhooks.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  if (!webhookId) {
    throw new Response("Missing webhook id", { status: 400 });
  }

  await processOrderCreateWebhook({
    webhookId,
    shop,
    payload: payload as never
  });

  return new Response();
};

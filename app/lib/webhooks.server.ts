import prisma from "~/db.server";

type OrderWebhookLineItem = {
  id?: number | string;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  title?: string;
  variant_title?: string | null;
  quantity?: number;
  properties?: Array<{ name?: string; value?: string }>;
};

type OrderWebhookPayload = {
  id?: number | string;
  name?: string;
  order_number?: number | string;
  created_at?: string;
  line_items?: OrderWebhookLineItem[];
};

export const processOrderCreateWebhook = async ({
  webhookId,
  shop,
  payload
}: {
  webhookId: string;
  shop: string;
  payload: OrderWebhookPayload;
}) => {
  const existingDelivery = await prisma.webhookDelivery.findUnique({
    where: { id: webhookId }
  });

  if (existingDelivery) {
    return { duplicate: true, linked: 0 };
  }

  const orderId = payload.id ? String(payload.id) : null;
  const orderName =
    payload.name ?? (payload.order_number ? `#${payload.order_number}` : null);
  const orderedAt = payload.created_at ? new Date(payload.created_at) : new Date();
  let linked = 0;

  await prisma.$transaction(async (tx) => {
    await tx.webhookDelivery.create({
      data: {
        id: webhookId,
        shop,
        topic: "orders/create"
      }
    });

    for (const lineItem of payload.line_items ?? []) {
      const uploadId = lineItem.properties?.find(
        (property) => property.name === "_stampmymark_upload_id"
      )?.value;

      if (!uploadId) {
        continue;
      }

      const result = await tx.upload.updateMany({
        where: {
          shop,
          uploadId,
          status: { not: "ordered" }
        },
        data: {
          status: "ordered",
          orderId,
          orderName,
          orderLineItemId: lineItem.id ? String(lineItem.id) : null,
          orderedAt,
          productId: lineItem.product_id ? String(lineItem.product_id) : undefined,
          variantId: lineItem.variant_id ? String(lineItem.variant_id) : undefined,
          productTitle: lineItem.title,
          variantTitle: lineItem.variant_title,
          quantity: lineItem.quantity
        }
      });

      linked += result.count;
    }
  });

  return { duplicate: false, linked };
};

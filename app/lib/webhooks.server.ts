import type { Prisma } from "@prisma/client";
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

const cleanText = (value: string | null | undefined, maxLength: number) => {
  if (!value) return null;

  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return cleaned || null;
};

const getLineItemProperty = (lineItem: OrderWebhookLineItem, name: string) =>
  lineItem.properties?.find((property) => property.name === name)?.value;

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
      const uploadId = getLineItemProperty(lineItem, "_stampmymark_upload_id");

      if (!uploadId) {
        continue;
      }

      const textData: Prisma.UploadUpdateManyMutationInput = {};
      const textAbove = cleanText(getLineItemProperty(lineItem, "Above"), 1000);
      const textBelow = cleanText(getLineItemProperty(lineItem, "Below"), 1000);
      const designerNotes = cleanText(getLineItemProperty(lineItem, "Notes"), 1500);

      if (textAbove) textData.textAbove = textAbove;
      if (textBelow) textData.textBelow = textBelow;
      if (designerNotes) textData.designerNotes = designerNotes;

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
          quantity: lineItem.quantity,
          ...textData
        }
      });

      linked += result.count;
    }
  });

  return { duplicate: false, linked };
};

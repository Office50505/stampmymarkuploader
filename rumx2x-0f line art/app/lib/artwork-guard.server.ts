import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "~/db.server";

const REQUIRED_ARTWORK_PROPERTY = "_stampmymark_upload_id";
const DEFAULT_REQUIRED_ARTWORK_PRODUCT_IDS = ["9659129037021"];
const ARTWORK_MISSING_TAGS = ["ARTWORK MISSING", "HOLD - DO NOT FULFILL"];

type OrderLineItem = {
  product_id?: number | string | null;
  title?: string;
  variant_title?: string | null;
  properties?: Array<{ name?: string; value?: string }>;
};

type ArtworkViolation = {
  productId: string;
  title: string;
  reason: "missing_upload" | "invalid_upload";
};

const getConfiguredProductIds = () => {
  const configuredIds = (process.env.REQUIRED_ARTWORK_PRODUCT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return new Set(configuredIds.length ? configuredIds : DEFAULT_REQUIRED_ARTWORK_PRODUCT_IDS);
};

const getProperty = (lineItem: OrderLineItem, name: string) =>
  lineItem.properties?.find((property) => property.name === name)?.value?.trim() || "";

const lineItemTitle = (lineItem: OrderLineItem) =>
  [lineItem.title, lineItem.variant_title].filter(Boolean).join(" — ") || "Permanent Stamp";

const toGid = (type: "Order", id: string) =>
  id.startsWith("gid://") ? id : `gid://shopify/${type}/${id}`;

const readGraphql = async <T>(admin: AdminApiContext, query: string, variables: Record<string, unknown>) => {
  const response = await admin.graphql(query, { variables });
  const body = await response.json() as { data?: T; errors?: Array<{ message?: string }> };

  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message || "Unknown Shopify GraphQL error").join("; "));
  }

  if (!body.data) throw new Error("Shopify GraphQL response did not contain data");
  return body.data;
};

/**
 * Finds Permanent Stamp lines whose upload property is absent or does not point
 * at a stored upload from this shop and product. This protects against direct
 * cart API calls that bypass the storefront uploader.
 */
export const findArtworkViolations = async ({ shop, lineItems }: { shop: string; lineItems: OrderLineItem[] }) => {
  const requiredProductIds = getConfiguredProductIds();
  const protectedLines = lineItems.filter((lineItem) => requiredProductIds.has(String(lineItem.product_id || "")));
  const uploadIds = [...new Set(protectedLines.map((lineItem) => getProperty(lineItem, REQUIRED_ARTWORK_PROPERTY)).filter(Boolean))];
  const uploads = uploadIds.length
    ? await prisma.upload.findMany({
        where: { shop, uploadId: { in: uploadIds } },
        select: { uploadId: true, productId: true }
      })
    : [];
  const uploadsById = new Map(uploads.map((upload) => [upload.uploadId, upload]));

  return protectedLines.flatMap<ArtworkViolation>((lineItem) => {
    const uploadId = getProperty(lineItem, REQUIRED_ARTWORK_PROPERTY);
    if (!uploadId) {
      return [{ productId: String(lineItem.product_id), title: lineItemTitle(lineItem), reason: "missing_upload" }];
    }

    const upload = uploadsById.get(uploadId);
    if (!upload || (upload.productId && upload.productId !== String(lineItem.product_id))) {
      return [{ productId: String(lineItem.product_id), title: lineItemTitle(lineItem), reason: "invalid_upload" }];
    }

    return [];
  });
};

/**
 * Adds a visible order hold marker, then places all fulfilment orders on a
 * native Shopify hold when the app has the required fulfilment permission.
 */
export const holdOrderForMissingArtwork = async ({
  admin,
  orderId,
  violations
}: {
  admin: AdminApiContext;
  orderId: string;
  violations: ArtworkViolation[];
}) => {
  const orderGid = toGid("Order", orderId);
  const reasonNotes = `Artwork upload required for: ${violations.map((violation) => violation.title).join(", ")}`.slice(0, 255);

  const tagData = await readGraphql<{
    tagsAdd: { userErrors: Array<{ message: string }> };
  }>(admin, `#graphql
    mutation AddArtworkMissingTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        userErrors {
          message
        }
      }
    }
  `, { id: orderGid, tags: ARTWORK_MISSING_TAGS });

  if (tagData.tagsAdd.userErrors.length) {
    throw new Error(tagData.tagsAdd.userErrors.map((error) => error.message).join("; "));
  }

  try {
    const fulfillmentData = await readGraphql<{
      order: { fulfillmentOrders: { nodes: Array<{ id: string }> } } | null;
    }>(admin, `#graphql
      query OrderFulfillmentOrdersForArtworkHold($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 25) {
            nodes {
              id
            }
          }
        }
      }
    `, { id: orderGid });

    const fulfillmentOrders = fulfillmentData.order?.fulfillmentOrders.nodes || [];
    for (const fulfillmentOrder of fulfillmentOrders) {
      const holdData = await readGraphql<{
        fulfillmentOrderHold: { userErrors: Array<{ message: string }> };
      }>(admin, `#graphql
        mutation HoldFulfillmentForMissingArtwork($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
          fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
            userErrors {
              message
            }
          }
        }
      `, {
        id: fulfillmentOrder.id,
        fulfillmentHold: {
          handle: "stampmymark-artwork-required",
          reason: "OTHER",
          reasonNotes,
          notifyMerchant: true
        }
      });

      const nonDuplicateErrors = holdData.fulfillmentOrderHold.userErrors.filter(
        (error) => !/duplicate hold|already.*hold/i.test(error.message)
      );
      if (nonDuplicateErrors.length) {
        console.error("[artwork-guard] Shopify could not apply fulfilment hold", {
          orderId,
          errors: nonDuplicateErrors.map((error) => error.message)
        });
      }
    }
  } catch (error) {
    // The order tags are the required safety net. Keep webhook delivery healthy if
    // fulfilment orders are not available yet or the merchant has not granted the hold scope.
    console.error("[artwork-guard] Shopify could not inspect fulfilment orders", { orderId, error });
  }
};

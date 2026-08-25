import type { UploadStatus } from "@prisma/client";
import crypto from "node:crypto";
import prisma from "~/db.server";
import { requireServerEnv, uploadConfig } from "./env.server";
import {
  createUploadId,
  validateUploadRequest
} from "./upload-validation.server";
import {
  fetchStoredFile,
  storageBucket,
  uploadStoredFile
} from "./storage.server";

export type UploadInitInput = {
  shop: string;
  filename: string;
  contentType: string;
  fileSize: number;
  productId?: string | null;
  productHandle?: string | null;
  productTitle?: string | null;
  variantId?: string | null;
  variantTitle?: string | null;
  selectedSize?: string | null;
  quantity?: number | null;
  sessionId?: string | null;
  cartToken?: string | null;
  customerId?: string | null;
};

export const initUpload = async (input: UploadInitInput) => {
  const validation = validateUploadRequest({
    filename: input.filename,
    contentType: input.contentType,
    fileSize: input.fileSize
  });

  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      errors: validation.errors
    };
  }

  const uploadId = createUploadId();
  const bucket = storageBucket();
  const shopSlug = input.shop.replace(/[^a-z0-9.-]/gi, "-").toLowerCase();
  const key = `shops/${shopSlug}/uploads/${uploadId}/${validation.sanitizedFilename}`;
  const expiresAt = new Date(
    Date.now() + uploadConfig.retentionDays * 24 * 60 * 60 * 1000
  );

  await prisma.upload.create({
    data: {
      uploadId,
      shop: input.shop,
      storageBucket: bucket,
      storageKey: key,
      storageUrl: `bunny://${bucket}/${key}`,
      originalFilename: input.filename,
      contentType: input.contentType,
      fileSize: input.fileSize,
      productId: input.productId,
      productHandle: input.productHandle,
      productTitle: input.productTitle,
      variantId: input.variantId,
      variantTitle: input.variantTitle,
      selectedSize: input.selectedSize,
      quantity: input.quantity,
      sessionId: input.sessionId,
      cartToken: input.cartToken,
      customerId: input.customerId,
      status: "uploaded",
      expiresAt
    }
  });

  return {
    ok: true as const,
    uploadId,
    storageKey: key,
    expiresAt
  };
};

export const storeUploadFile = async ({
  shop,
  uploadId,
  sessionId,
  file
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  file: File;
}) => {
  const upload = await prisma.upload.findFirst({
    where: {
      shop,
      uploadId,
      removedAt: null
    }
  });

  if (!upload) {
    return { ok: false as const, status: 404, errors: ["Upload not found."] };
  }

  if (upload.sessionId && sessionId && upload.sessionId !== sessionId) {
    return { ok: false as const, status: 403, errors: ["Upload mismatch."] };
  }

  const validation = validateUploadRequest({
    filename: file.name,
    contentType: file.type,
    fileSize: file.size
  });
  const errors: string[] = [];

  if (!validation.ok) {
    errors.push(...validation.errors);
  }

  if (file.size !== Number(upload.fileSize)) {
    errors.push("Uploaded file size does not match the initialized upload.");
  }

  if (file.type !== upload.contentType) {
    errors.push("Uploaded file type does not match the initialized upload.");
  }

  if (errors.length > 0) {
    return { ok: false as const, status: 422, errors };
  }

  const body = Buffer.from(await file.arrayBuffer());
  await uploadStoredFile({
    key: upload.storageKey,
    contentType: upload.contentType,
    body
  });

  const uploadedAt = new Date();
  const updated = await prisma.upload.update({
    where: { uploadId },
    data: {
      uploadedAt,
      status: "uploaded"
    }
  });

  return { ok: true as const, upload: updated };
};

export const completeUpload = async ({
  shop,
  uploadId,
  sessionId
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
}) => {
  const upload = await prisma.upload.findFirst({
    where: {
      shop,
      uploadId,
      removedAt: null
    }
  });

  if (!upload) {
    return { ok: false as const, status: 404, errors: ["Upload not found."] };
  }

  if (upload.sessionId && sessionId && upload.sessionId !== sessionId) {
    return { ok: false as const, status: 403, errors: ["Upload mismatch."] };
  }

  if (!upload.uploadedAt) {
    return { ok: false as const, status: 409, errors: ["Upload is not complete."] };
  }

  return { ok: true as const, upload };
};

export const markUploadInCart = async ({
  shop,
  uploadId,
  sessionId,
  cartToken,
  quantity,
  selectedSize,
  variantId
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  cartToken?: string | null;
  quantity?: number | null;
  selectedSize?: string | null;
  variantId?: string | null;
}) => {
  const upload = await prisma.upload.findFirst({
    where: { shop, uploadId, removedAt: null }
  });

  if (!upload || !upload.uploadedAt) {
    return {
      ok: false as const,
      status: 409,
      errors: ["Upload must finish before adding to cart."]
    };
  }

  if (upload.sessionId && sessionId && upload.sessionId !== sessionId) {
    return { ok: false as const, status: 403, errors: ["Upload mismatch."] };
  }

  await prisma.upload.update({
    where: { uploadId },
    data: {
      status: "cart",
      cartToken,
      quantity: quantity ?? upload.quantity,
      selectedSize: selectedSize ?? upload.selectedSize,
      variantId: variantId ?? upload.variantId
    }
  });

  return { ok: true as const };
};

export const removeUpload = async ({
  shop,
  uploadId,
  sessionId
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
}) => {
  const upload = await prisma.upload.findFirst({
    where: { shop, uploadId, removedAt: null }
  });

  if (!upload) {
    return { ok: true as const };
  }

  if (upload.sessionId && sessionId && upload.sessionId !== sessionId) {
    return { ok: false as const, status: 403, errors: ["Upload mismatch."] };
  }

  await prisma.upload.update({
    where: { uploadId },
    data: {
      removedAt: new Date(),
      status: "abandoned"
    }
  });

  return { ok: true as const };
};

export const listUploads = async ({
  shop,
  status,
  query
}: {
  shop: string;
  status?: UploadStatus | "unordered";
  query?: string;
}) => {
  const statusFilter =
    status === "unordered"
      ? { status: { in: ["uploaded", "cart", "abandoned"] as UploadStatus[] } }
      : status
        ? { status }
        : {};

  return prisma.upload.findMany({
    where: {
      shop,
      ...statusFilter,
      ...(query
        ? {
            OR: [
              { uploadId: { contains: query, mode: "insensitive" } },
              { originalFilename: { contains: query, mode: "insensitive" } },
              { productTitle: { contains: query, mode: "insensitive" } },
              { orderName: { contains: query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
};

export const getUploadForAdmin = async (shop: string, uploadId: string) => {
  return prisma.upload.findFirst({
    where: { shop, uploadId }
  });
};

export const createAdminFileUrl = async ({
  shop,
  uploadId,
  inline
}: {
  shop: string;
  uploadId: string;
  inline?: boolean;
}) => {
  const upload = await getUploadForAdmin(shop, uploadId);
  if (!upload) {
    return null;
  }

  const expires = Math.floor(Date.now() / 1000) + 10 * 60;
  const inlineValue = inline ? "1" : "0";
  const signature = signAdminFileUrl({
    shop,
    uploadId: upload.uploadId,
    expires,
    inline: inlineValue
  });

  return {
    url:
      `/app/uploads/${encodeURIComponent(upload.uploadId)}/file` +
      `?shop=${encodeURIComponent(shop)}` +
      `&expires=${expires}` +
      `&inline=${inlineValue}` +
      `&signature=${signature}`
  };
};

const adminFileSignaturePayload = ({
  shop,
  uploadId,
  expires,
  inline
}: {
  shop: string;
  uploadId: string;
  expires: number;
  inline: string;
}) => `${shop}:${uploadId}:${expires}:${inline}`;

const signAdminFileUrl = (input: {
  shop: string;
  uploadId: string;
  expires: number;
  inline: string;
}) =>
  crypto
    .createHmac("sha256", requireServerEnv("SHOPIFY_API_SECRET"))
    .update(adminFileSignaturePayload(input))
    .digest("hex");

export const verifyAdminFileUrlSignature = ({
  shop,
  uploadId,
  expires,
  inline,
  signature
}: {
  shop: string | null;
  uploadId: string;
  expires: string | null;
  inline: string | null;
  signature: string | null;
}) => {
  if (!shop || !expires || !signature) {
    return null;
  }

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  const inlineValue = inline === "1" ? "1" : "0";
  const expected = signAdminFileUrl({
    shop,
    uploadId,
    expires: expiresAt,
    inline: inlineValue
  });
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  return { shop, inline: inlineValue === "1" };
};

export const getStoredUploadResponse = async (shop: string, uploadId: string) => {
  const upload = await getUploadForAdmin(shop, uploadId);
  if (!upload) {
    return null;
  }

  const file = await fetchStoredFile(upload.storageKey);
  return { upload, file };
};

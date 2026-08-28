import type { Prisma, Upload, UploadStatus } from "@prisma/client";
import crypto from "node:crypto";
import prisma from "~/db.server";
import { requireServerEnv, uploadConfig } from "./env.server";
import {
  createUploadId,
  detectContentTypeFromBytes,
  validateUploadRequest
} from "./upload-validation.server";
import {
  fetchStoredFile,
  storageBucket,
  uploadStoredFile
} from "./storage.server";
import type { IpLocation } from "./ip-geolocation.server";

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
  ipLocation?: IpLocation | null;
};

const cleanText = (value: string | null | undefined, maxLength: number) => {
  if (!value) {
    return null;
  }

  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return cleaned || null;
};

const cleanQuantity = (quantity: number | null | undefined) => {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 1) {
    return null;
  }

  return Math.min(Math.floor(quantity), 9999);
};

const validateUploadSession = (
  upload: { sessionId: string | null },
  sessionId?: string | null
) => {
  if (!upload.sessionId || !sessionId || upload.sessionId !== sessionId) {
    return {
      ok: false as const,
      status: 403,
      errors: ["Upload session could not be verified."]
    };
  }

  return { ok: true as const };
};

export const initUpload = async (input: UploadInitInput) => {
  const sessionId = cleanText(input.sessionId, 128);
  if (!sessionId) {
    return {
      ok: false as const,
      status: 400,
      errors: ["Upload session is required."]
    };
  }

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

  const upload = await prisma.upload.create({
    data: {
      uploadId,
      shop: input.shop,
      storageBucket: bucket,
      storageKey: key,
      storageUrl: `bunny://${bucket}/${key}`,
      originalFilename: validation.displayFilename,
      contentType: input.contentType,
      fileSize: input.fileSize,
      productId: cleanText(input.productId, 64),
      productHandle: cleanText(input.productHandle, 160),
      productTitle: cleanText(input.productTitle, 255),
      variantId: cleanText(input.variantId, 64),
      variantTitle: cleanText(input.variantTitle, 255),
      selectedSize: cleanText(input.selectedSize, 120),
      quantity: cleanQuantity(input.quantity),
      sessionId,
      cartToken: cleanText(input.cartToken, 160),
      customerId: cleanText(input.customerId, 64),
      ipAddress: cleanText(input.ipLocation?.ipAddress, 64),
      ipCity: cleanText(input.ipLocation?.ipCity, 120),
      ipRegion: cleanText(input.ipLocation?.ipRegion, 120),
      ipRegionCode: cleanText(input.ipLocation?.ipRegionCode, 32),
      ipPostalCode: cleanText(input.ipLocation?.ipPostalCode, 32),
      ipCountryCode: cleanText(input.ipLocation?.ipCountryCode, 8),
      ipCountry: cleanText(input.ipLocation?.ipCountry, 120),
      ipContinentCode: cleanText(input.ipLocation?.ipContinentCode, 8),
      ipContinent: cleanText(input.ipLocation?.ipContinent, 120),
      ipAsn: cleanText(input.ipLocation?.ipAsn, 32),
      ipAsName: cleanText(input.ipLocation?.ipAsName, 160),
      ipAsDomain: cleanText(input.ipLocation?.ipAsDomain, 160),
      ipGeolocatedAt: input.ipLocation?.ipGeolocatedAt ?? null,
      status: "uploaded",
      expiresAt
    }
  });

  return {
    ok: true as const,
    uploadId,
    storageKey: key,
    expiresAt,
    artworkUrl: createOrderFileUrl(upload)
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

  const sessionValidation = validateUploadSession(upload, sessionId);
  if (!sessionValidation.ok) {
    return sessionValidation;
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
  const detectedContentType = detectContentTypeFromBytes(body);
  if (!detectedContentType || detectedContentType !== upload.contentType) {
    return {
      ok: false as const,
      status: 422,
      errors: ["Uploaded file contents do not match the allowed file type."]
    };
  }

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

  const sessionValidation = validateUploadSession(upload, sessionId);
  if (!sessionValidation.ok) {
    return sessionValidation;
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
  variantId,
  textAbove,
  textBelow,
  designerNotes
}: {
  shop: string;
  uploadId: string;
  sessionId?: string | null;
  cartToken?: string | null;
  quantity?: number | null;
  selectedSize?: string | null;
  variantId?: string | null;
  textAbove?: string | null;
  textBelow?: string | null;
  designerNotes?: string | null;
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

  const sessionValidation = validateUploadSession(upload, sessionId);
  if (!sessionValidation.ok) {
    return sessionValidation;
  }

  await prisma.upload.update({
    where: { uploadId },
    data: {
      status: "cart",
      cartToken: cleanText(cartToken, 160),
      quantity: cleanQuantity(quantity) ?? upload.quantity,
      selectedSize: cleanText(selectedSize, 120) ?? upload.selectedSize,
      variantId: cleanText(variantId, 64) ?? upload.variantId,
      textAbove: cleanText(textAbove, 1000),
      textBelow: cleanText(textBelow, 1000),
      designerNotes: cleanText(designerNotes, 1500)
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

  const sessionValidation = validateUploadSession(upload, sessionId);
  if (!sessionValidation.ok) {
    return sessionValidation;
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

type UploadListInput = {
  shop: string;
  status?: UploadStatus | "unordered";
  query?: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
};

type UploadPageInput = UploadListInput & {
  page?: number;
  pageSize?: number;
};

const cleanUploadQuery = (query?: string) =>
  query
    ? query
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120)
    : "";

const buildUploadWhere = ({
  shop,
  status,
  query,
  dateFrom,
  dateTo
}: UploadListInput): Prisma.UploadWhereInput => {
  const statusFilter =
    status === "unordered"
      ? { status: { in: ["uploaded", "cart", "abandoned"] as UploadStatus[] } }
      : status
        ? { status }
        : {};
  const cleanedQuery = cleanUploadQuery(query);
  const createdAtFilter =
    dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {})
          }
        }
      : {};

  return {
    shop,
    ...statusFilter,
    ...createdAtFilter,
    ...(cleanedQuery
      ? {
          OR: [
            { uploadId: { contains: cleanedQuery, mode: "insensitive" } },
            { originalFilename: { contains: cleanedQuery, mode: "insensitive" } },
            { productTitle: { contains: cleanedQuery, mode: "insensitive" } },
            { orderName: { contains: cleanedQuery, mode: "insensitive" } },
            { ipAddress: { contains: cleanedQuery, mode: "insensitive" } },
            { ipCity: { contains: cleanedQuery, mode: "insensitive" } },
            { ipRegion: { contains: cleanedQuery, mode: "insensitive" } },
            { ipRegionCode: { contains: cleanedQuery, mode: "insensitive" } },
            { ipPostalCode: { contains: cleanedQuery, mode: "insensitive" } },
            { ipCountryCode: { contains: cleanedQuery, mode: "insensitive" } },
            { ipCountry: { contains: cleanedQuery, mode: "insensitive" } },
            { ipAsn: { contains: cleanedQuery, mode: "insensitive" } },
            { ipAsName: { contains: cleanedQuery, mode: "insensitive" } },
            { textAbove: { contains: cleanedQuery, mode: "insensitive" } },
            { textBelow: { contains: cleanedQuery, mode: "insensitive" } },
            { designerNotes: { contains: cleanedQuery, mode: "insensitive" } }
          ]
        }
      : {})
  };
};

export const countUploads = async (input: UploadListInput) => {
  return prisma.upload.count({
    where: buildUploadWhere(input)
  });
};

export const listUploads = async ({
  page = 1,
  pageSize = 10,
  ...input
}: UploadPageInput) => {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));

  return prisma.upload.findMany({
    where: buildUploadWhere(input),
    orderBy: { createdAt: "desc" },
    skip: (safePage - 1) * safePageSize,
    take: safePageSize
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

const orderFileSignaturePayload = (
  upload: Pick<Upload, "shop" | "uploadId" | "storageKey">
) => `${upload.shop}:${upload.uploadId}:${upload.storageKey}`;

const signOrderFileUrl = (upload: Pick<Upload, "shop" | "uploadId" | "storageKey">) =>
  crypto
    .createHmac("sha256", requireServerEnv("SHOPIFY_API_SECRET"))
    .update(orderFileSignaturePayload(upload))
    .digest("hex");

export const createOrderFileUrl = (
  upload: Pick<Upload, "shop" | "uploadId" | "storageKey">
) => {
  const appUrl = requireServerEnv("SHOPIFY_APP_URL").replace(/\/+$/, "");
  const token = signOrderFileUrl(upload);

  return (
    `${appUrl}/uploads/${encodeURIComponent(upload.uploadId)}/file` +
    `?token=${encodeURIComponent(token)}`
  );
};

export const getStoredUploadResponseForOrderLink = async ({
  uploadId,
  token
}: {
  uploadId: string;
  token: string | null;
}) => {
  if (!uploadId || !token || !/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }

  const upload = await prisma.upload.findUnique({
    where: { uploadId }
  });

  if (!upload || upload.removedAt || upload.status === "expired" || !upload.uploadedAt) {
    return null;
  }

  const expected = signOrderFileUrl(upload);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(token, "hex");

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  const file = await fetchStoredFile(upload.storageKey);
  return { upload, file };
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

import crypto from "crypto";
import { uploadConfig } from "./env.server";

const allowedTypes = new Map([
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
  ["application/pdf", ["pdf"]]
]);

export type UploadValidationInput = {
  filename: string;
  contentType: string;
  fileSize: number;
};

export const allowedContentTypes = Array.from(allowedTypes.keys());

export const createUploadId = () =>
  `up_${crypto.randomUUID().replaceAll("-", "")}`;

export const sanitizeFilename = (filename: string) => {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);

  return cleaned || "upload";
};

export const extensionForFilename = (filename: string) => {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match?.[1]?.toLowerCase() ?? "";
};

export const validateUploadRequest = ({
  filename,
  contentType,
  fileSize
}: UploadValidationInput) => {
  const errors: string[] = [];
  const allowedExtensions = allowedTypes.get(contentType);
  const extension = extensionForFilename(filename);

  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    errors.push("File must be JPG, JPEG, PNG, WEBP, or PDF.");
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    errors.push("File size is required.");
  } else if (fileSize > uploadConfig.maxBytes) {
    errors.push(
      `File must be ${Math.round(uploadConfig.maxBytes / 1024 / 1024)}MB or smaller.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    sanitizedFilename: sanitizeFilename(filename),
    extension
  };
};

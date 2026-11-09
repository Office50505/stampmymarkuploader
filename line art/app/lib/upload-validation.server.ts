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
const maxFilenameLength = 120;

export const createUploadId = () =>
  `up_${crypto.randomUUID().replaceAll("-", "")}`;

export const sanitizeFilename = (filename: string) => {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, maxFilenameLength);

  return cleaned || "upload";
};

export const sanitizeDisplayFilename = (filename: string) => {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxFilenameLength);

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
    displayFilename: sanitizeDisplayFilename(filename),
    extension
  };
};

export const detectContentTypeFromBytes = (body: Buffer) => {
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    body.length >= 8 &&
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47 &&
    body[4] === 0x0d &&
    body[5] === 0x0a &&
    body[6] === 0x1a &&
    body[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    body.length >= 12 &&
    body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  const pdfHeaderIndex = body.subarray(0, 1024).indexOf("%PDF");
  if (pdfHeaderIndex >= 0) {
    return "application/pdf";
  }

  return null;
};

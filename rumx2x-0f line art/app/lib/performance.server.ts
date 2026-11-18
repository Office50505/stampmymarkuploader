import crypto from "node:crypto";

export const clientPerformancePhases = [
  "upload",
  "line_art",
  "mockups",
  "ink_switch",
  "instant_preview"
] as const;

export type ClientPerformancePhase = (typeof clientPerformancePhases)[number];
export type PerformanceOutcome = "success" | "failure" | "queued" | "cancelled";

type PerformanceMetric = {
  source: "client" | "server";
  phase: ClientPerformancePhase | "mockup_kind";
  outcome: PerformanceOutcome;
  durationMs: number;
  shop: string;
  uploadId: string;
  inkColor?: string | null;
  mode?: string | null;
  kind?: string | null;
  previewCount?: number | null;
  errorCode?: string | null;
};

const supportedInkColors = new Set([
  "black",
  "blue",
  "green",
  "purple",
  "red",
  "white"
]);
const supportedMockupKinds = new Set(["bag", "cup", "box"]);
const safeLabelPattern = /^[a-z0-9_-]{1,48}$/;
const maximumDurationMs = 10 * 60 * 1000;

const boundedInteger = (value: unknown, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
};

const safeLabel = (value: unknown) => {
  const normalized = String(value || "").trim().toLowerCase();
  return safeLabelPattern.test(normalized) ? normalized : null;
};

const anonymizeUpload = (shop: string, uploadId: string) =>
  crypto
    .createHash("sha256")
    .update(`${shop}\0${uploadId}`)
    .digest("hex")
    .slice(0, 16);

export const logPerformanceMetric = (metric: PerformanceMetric) => {
  const inkColor = safeLabel(metric.inkColor);
  const kind = safeLabel(metric.kind);
  const mode = safeLabel(metric.mode);
  const errorCode = safeLabel(metric.errorCode);

  console.info(
    JSON.stringify({
      metric: "stamp_upload_performance",
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      source: metric.source,
      phase: metric.phase,
      outcome: metric.outcome,
      durationMs: boundedInteger(metric.durationMs, 0, maximumDurationMs),
      shop: metric.shop,
      uploadRef: anonymizeUpload(metric.shop, metric.uploadId),
      ...(inkColor && supportedInkColors.has(inkColor) ? { inkColor } : {}),
      ...(mode ? { mode } : {}),
      ...(kind && supportedMockupKinds.has(kind) ? { kind } : {}),
      ...(metric.previewCount !== null && metric.previewCount !== undefined
        ? { previewCount: boundedInteger(metric.previewCount, 0, 3) }
        : {}),
      ...(errorCode ? { errorCode } : {})
    })
  );
};

export const parseClientPerformanceMetric = (body: unknown) => {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  const phase = safeLabel(candidate.phase);
  const outcome = safeLabel(candidate.outcome);
  const durationMs = Number(candidate.durationMs);

  if (
    !phase ||
    !clientPerformancePhases.includes(phase as ClientPerformancePhase) ||
    (outcome !== "success" && outcome !== "failure") ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  return {
    phase: phase as ClientPerformancePhase,
    outcome: outcome as "success" | "failure",
    durationMs: boundedInteger(durationMs, 0, maximumDurationMs),
    inkColor: safeLabel(candidate.inkColor),
    mode: safeLabel(candidate.mode),
    errorCode: safeLabel(candidate.errorCode)
  };
};

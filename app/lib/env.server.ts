const numberFromEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const uploadConfig = {
  maxBytes: numberFromEnv("UPLOAD_MAX_BYTES", 25 * 1024 * 1024),
  retentionDays: numberFromEnv("UPLOAD_RETENTION_DAYS", 30),
  deleteExpiredObjects: process.env.UPLOAD_DELETE_EXPIRED_OBJECTS === "true"
};

export const bunnyConfig = {
  storageZone: process.env.BUNNY_STORAGE_ZONE || "",
  accessKey: process.env.BUNNY_STORAGE_ACCESS_KEY || "",
  endpoint: (process.env.BUNNY_STORAGE_ENDPOINT || "https://storage.bunnycdn.com").replace(/\/$/, ""),
  pullZoneUrl: (process.env.BUNNY_PULL_ZONE_URL || "").replace(/\/$/, "")
};

export const ipinfoConfig = {
  token: process.env.IPINFO_TOKEN || "",
  enabled: (process.env.IP_GEOLOCATION_PROVIDER || "").toLowerCase() === "ipinfo"
};

export const requireServerEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

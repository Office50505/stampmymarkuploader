import { ipgeolocationConfig, ipinfoConfig } from "./env.server";

export type IpLocation = {
  ipAddress: string | null;
  ipCity: string | null;
  ipRegion: string | null;
  ipRegionCode: string | null;
  ipPostalCode: string | null;
  ipCountryCode: string | null;
  ipCountry: string | null;
  ipContinentCode: string | null;
  ipContinent: string | null;
  ipAsn: string | null;
  ipAsName: string | null;
  ipAsDomain: string | null;
  ipGeolocatedAt: Date | null;
};

type IpInfoLiteResponse = {
  ip?: string;
  country?: string;
  country_code?: string;
  continent?: string;
  continent_code?: string;
  asn?: string;
  as_name?: string;
  as_domain?: string;
};

type IpGeolocationResponse = {
  ip?: string;
  continent_code?: string;
  continent_name?: string;
  country_code2?: string;
  country_code3?: string;
  country_name?: string;
  state_prov?: string;
  state_code?: string;
  district?: string;
  city?: string;
  zipcode?: string;
  isp?: string;
  organization?: string;
  asn?: string;
};

const maxFieldLength = 160;

const cleanField = (value: unknown, maxLength = maxFieldLength) => {
  if (typeof value !== "string") {
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

const normalizeIp = (value: string) =>
  value
    .replace(/^"|"$/g, "")
    .replace(/^::ffff:/i, "")
    .trim();

const isUsableIp = (value: string) => {
  const ip = normalizeIp(value);

  return Boolean(
    ip &&
      ip !== "unknown" &&
      ip !== "::1" &&
      ip !== "127.0.0.1" &&
      !ip.startsWith("10.") &&
      !ip.startsWith("192.168.") &&
      !/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
};

export const getClientIpFromRequest = (request: Request) => {
  const candidates = [
    ...(request.headers.get("x-forwarded-for")?.split(",") ?? []),
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("x-client-ip"),
    request.headers.get("fly-client-ip")
  ];

  const match = candidates.find((candidate) => candidate && isUsableIp(candidate));
  return match ? normalizeIp(match) : null;
};

const emptyLocation = (ipAddress: string | null): IpLocation => ({
  ipAddress,
  ipCity: null,
  ipRegion: null,
  ipRegionCode: null,
  ipPostalCode: null,
  ipCountryCode: null,
  ipCountry: null,
  ipContinentCode: null,
  ipContinent: null,
  ipAsn: null,
  ipAsName: null,
  ipAsDomain: null,
  ipGeolocatedAt: null
});

const fetchJson = async <ResponseBody>(url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as ResponseBody | null;
};

const lookupWithIpgeolocation = async (ipAddress: string): Promise<IpLocation> => {
  const body = await fetchJson<IpGeolocationResponse>(
    `https://api.ipgeolocation.io/ipgeo?apiKey=${encodeURIComponent(
      ipgeolocationConfig.apiKey
    )}&ip=${encodeURIComponent(ipAddress)}`
  );

  if (!body) {
    return emptyLocation(ipAddress);
  }

  return {
    ipAddress,
    ipCity: cleanField(body.city, 120),
    ipRegion: cleanField(body.state_prov || body.district, 120),
    ipRegionCode: cleanField(body.state_code, 32),
    ipPostalCode: cleanField(body.zipcode, 32),
    ipCountryCode: cleanField(body.country_code2 || body.country_code3, 8),
    ipCountry: cleanField(body.country_name),
    ipContinentCode: cleanField(body.continent_code, 8),
    ipContinent: cleanField(body.continent_name),
    ipAsn: cleanField(body.asn, 32),
    ipAsName: cleanField(body.organization || body.isp),
    ipAsDomain: null,
    ipGeolocatedAt: new Date()
  };
};

const lookupWithIpinfo = async (ipAddress: string): Promise<IpLocation> => {
  const body = await fetchJson<IpInfoLiteResponse>(
    `https://api.ipinfo.io/lite/${encodeURIComponent(ipAddress)}?token=${encodeURIComponent(
      ipinfoConfig.token
    )}`
  );

  if (!body) {
    return emptyLocation(ipAddress);
  }

  return {
    ipAddress,
    ipCity: null,
    ipRegion: null,
    ipRegionCode: null,
    ipPostalCode: null,
    ipCountryCode: cleanField(body.country_code, 8),
    ipCountry: cleanField(body.country),
    ipContinentCode: cleanField(body.continent_code, 8),
    ipContinent: cleanField(body.continent),
    ipAsn: cleanField(body.asn, 32),
    ipAsName: cleanField(body.as_name),
    ipAsDomain: cleanField(body.as_domain),
    ipGeolocatedAt: new Date()
  };
};

export const lookupIpLocation = async (ipAddress: string | null): Promise<IpLocation> => {
  if (!ipAddress) {
    return emptyLocation(ipAddress);
  }

  try {
    if (ipgeolocationConfig.enabled && ipgeolocationConfig.apiKey) {
      return await lookupWithIpgeolocation(ipAddress);
    }

    if (ipinfoConfig.enabled && ipinfoConfig.token) {
      return await lookupWithIpinfo(ipAddress);
    }

    return emptyLocation(ipAddress);
  } catch {
    return emptyLocation(ipAddress);
  }
};

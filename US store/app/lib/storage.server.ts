import { bunnyConfig, requireServerEnv } from "./env.server";

export const storageBucket = () => {
  if (!bunnyConfig.storageZone) {
    return requireServerEnv("BUNNY_STORAGE_ZONE");
  }
  return bunnyConfig.storageZone;
};

const accessKey = () => {
  if (!bunnyConfig.accessKey) {
    return requireServerEnv("BUNNY_STORAGE_ACCESS_KEY");
  }
  return bunnyConfig.accessKey;
};

const bunnyUrlForKey = (key: string) => {
  const cleanKey = key.replace(/^\/+/, "");
  const encodedKey = cleanKey.split("/").map(encodeURIComponent).join("/");

  return `${bunnyConfig.endpoint}/${encodeURIComponent(storageBucket())}/${encodedKey}`;
};

export const uploadStoredFile = async ({
  key,
  contentType,
  body
}: {
  key: string;
  contentType: string;
  body: Buffer;
}) => {
  const response = await fetch(bunnyUrlForKey(key), {
    method: "PUT",
    headers: {
      AccessKey: accessKey(),
      "Content-Type": contentType
    },
    body: body as unknown as BodyInit
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Bunny upload failed with ${response.status}${message ? `: ${message}` : ""}`
    );
  }
};

export const fetchStoredFile = async (key: string) => {
  const response = await fetch(bunnyUrlForKey(key), {
    method: "GET",
    headers: {
      AccessKey: accessKey()
    }
  });

  if (!response.ok) {
    throw new Error(`Bunny download failed with ${response.status}`);
  }

  return response;
};

export const deleteStoredObject = async (key: string) => {
  const response = await fetch(bunnyUrlForKey(key), {
    method: "DELETE",
    headers: {
      AccessKey: accessKey()
    }
  });

  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Bunny delete failed with ${response.status}${message ? `: ${message}` : ""}`
    );
  }
};

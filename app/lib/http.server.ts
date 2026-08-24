export const jsonResponse = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

export const errorResponse = (
  message: string,
  status = 400,
  details?: unknown
) =>
  jsonResponse(
    {
      ok: false,
      error: message,
      details
    },
    { status }
  );

export const getShopFromAppProxy = (
  context: { session?: { shop?: string }; shop?: string },
  request: Request
) => {
  const url = new URL(request.url);
  return context.session?.shop ?? context.shop ?? url.searchParams.get("shop");
};

export const optionalString = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim();
};

export const optionalNumber = (value: FormDataEntryValue | null) => {
  const raw = optionalString(value);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

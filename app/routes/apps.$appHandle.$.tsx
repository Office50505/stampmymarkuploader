import { redirect, type LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const splat = params["*"] || "";
  const nestedPath = splat.startsWith("app") ? splat.slice(3) : splat;
  const path = nestedPath
    ? `/${nestedPath.replace(/^\/+/, "")}`
    : "";

  throw redirect(`/app${path}${url.search}`);
};

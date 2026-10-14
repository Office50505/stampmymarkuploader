import { redirect, type LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const splat = params["*"] || "";
  const nestedPath = splat.startsWith("app") ? splat.slice(3) : splat;
  const path = nestedPath
    ? `/${nestedPath.replace(/^\/+/, "")}`
    : "";

  throw redirect(`/app${path}${url.search}`);
};

export default function InstalledAppNestedRedirect() {
  useEffect(() => {
    const path = window.location.pathname.includes("/app/")
      ? window.location.pathname.replace(/^.*\/app/, "/app")
      : "/app";
    window.location.replace(path + window.location.search);
  }, []);

  return <p>Opening StampMyMark uploader...</p>;
}

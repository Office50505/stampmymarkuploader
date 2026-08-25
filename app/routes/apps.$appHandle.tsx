import { redirect, type LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";

const target = "/app/uploads";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`${target}${url.search}`);
};

export default function InstalledAppEntryRedirect() {
  useEffect(() => {
    window.location.replace(target + window.location.search);
  }, []);

  return <p>Opening uploads...</p>;
}

import type { LoaderFunctionArgs } from "react-router";

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("ok", {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain"
    }
  });
};

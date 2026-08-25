import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/uploads">Uploads</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 200) {
    return <RecoverFromBareSuccess />;
  }

  return boundary.error(error);
}

function RecoverFromBareSuccess() {
  useEffect(() => {
    window.location.replace(`/app${window.location.search}`);
  }, []);

  return <p>Opening StampMyMark uploader...</p>;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

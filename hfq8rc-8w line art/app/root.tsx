import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {isRouteErrorResponse(error) ? (
          boundary.error(error)
        ) : (
          <main style={{ padding: "32px", fontFamily: "Inter, sans-serif" }}>
            <h1>Something went wrong</h1>
            <p>Please refresh the app.</p>
          </main>
        )}
        <Scripts />
      </body>
    </html>
  );
}

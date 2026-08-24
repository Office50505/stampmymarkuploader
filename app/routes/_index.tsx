import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  await login(request);
  return null;
};

export default function Index() {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Install StampMyMark Uploader">
          <Form method="post">
            <s-text-field
              label="Shop domain"
              name="shop"
              placeholder="stampmymark.myshopify.com"
            ></s-text-field>
            <s-button type="submit" variant="primary">
              Log in
            </s-button>
          </Form>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

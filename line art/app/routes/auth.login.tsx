import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form } from "react-router";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await login(request);
  return null;
};

export default function AuthLogin() {
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Log in">
          <Form method="post">
            <s-text-field
              label="Shop domain"
              name="shop"
              placeholder="stampmymark.myshopify.com"
            ></s-text-field>
            <s-button type="submit" variant="primary">
              Continue
            </s-button>
          </Form>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

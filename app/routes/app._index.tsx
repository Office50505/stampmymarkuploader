import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [all, ordered, unordered, expired] = await Promise.all([
    prisma.upload.count({ where: { shop } }),
    prisma.upload.count({ where: { shop, status: "ordered" } }),
    prisma.upload.count({
      where: { shop, status: { in: ["uploaded", "cart", "abandoned"] } }
    }),
    prisma.upload.count({ where: { shop, status: "expired" } })
  ]);

  return { stats: { all, ordered, unordered, expired } };
};

export default function DashboardIndex() {
  const { stats } = useLoaderData<typeof loader>();

  return (
    <s-page>
      <TitleBar title="StampMyMark uploader" />
      <s-section heading="Upload dashboard">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" border="base" borderRadius="base">
            <s-heading>All</s-heading>
            <s-text>{stats.all}</s-text>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-heading>Ordered</s-heading>
            <s-text>{stats.ordered}</s-text>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-heading>Unordered</s-heading>
            <s-text>{stats.unordered}</s-text>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-heading>Expired</s-heading>
            <s-text>{stats.expired}</s-text>
          </s-box>
        </s-grid>
        <s-stack direction="inline" gap="base">
          <Link to="/app/uploads">View uploads</Link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

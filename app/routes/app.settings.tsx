import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { bunnyConfig, uploadConfig } from "../lib/env.server";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

const supportedFileTypes = ["JPG", "JPEG", "PNG", "WEBP", "PDF"];

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const configuredState = (value: string) => (value ? "Configured" : "Missing");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    appUrl: process.env.SHOPIFY_APP_URL || process.env.HOST || "",
    appProxyPath: "/apps/stamp-upload",
    upload: {
      maxFileSize: formatFileSize(uploadConfig.maxBytes),
      retentionDays: uploadConfig.retentionDays,
      deleteExpiredObjects: uploadConfig.deleteExpiredObjects ? "Enabled" : "Disabled",
      supportedFileTypes: supportedFileTypes.join(", ")
    },
    bunny: {
      storageZone: bunnyConfig.storageZone,
      endpoint: bunnyConfig.endpoint,
      pullZoneUrl: bunnyConfig.pullZoneUrl,
      accessKeyStatus: configuredState(bunnyConfig.accessKey)
    },
    operations: {
      cleanupCommand: "npm run cleanup",
      appProxyTarget: "/apps/stamp-upload",
      orderWebhook: "orders/create",
      themeBlock: "Upload Picture"
    }
  };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page>
      <TitleBar title="Settings" />
      <s-section heading="Settings">
        <div className="dashboardHero">
          <div>
            <h1>Uploader settings</h1>
            <p>
              Review the live app configuration without exposing Shopify or Bunny.net
              secrets.
            </p>
          </div>
          <Link className="primaryButton" to="/app/uploads">View uploads</Link>
        </div>

        <div className="settingsGrid">
          <section className="settingsCard" aria-labelledby="upload-settings">
            <h2 id="upload-settings">Upload rules</h2>
            <dl className="settingsList">
              <div>
                <dt>Allowed files</dt>
                <dd>{data.upload.supportedFileTypes}</dd>
              </div>
              <div>
                <dt>Maximum size</dt>
                <dd>{data.upload.maxFileSize}</dd>
              </div>
              <div>
                <dt>Retention</dt>
                <dd>{data.upload.retentionDays} days</dd>
              </div>
              <div>
                <dt>Delete expired files</dt>
                <dd>{data.upload.deleteExpiredObjects}</dd>
              </div>
            </dl>
          </section>

          <section className="settingsCard" aria-labelledby="storage-settings">
            <h2 id="storage-settings">Bunny.net storage</h2>
            <dl className="settingsList">
              <div>
                <dt>Storage zone</dt>
                <dd>{data.bunny.storageZone || "Not configured"}</dd>
              </div>
              <div>
                <dt>Storage endpoint</dt>
                <dd>{data.bunny.endpoint || "Not configured"}</dd>
              </div>
              <div>
                <dt>Pull zone URL</dt>
                <dd>{data.bunny.pullZoneUrl || "Not configured"}</dd>
              </div>
              <div>
                <dt>Access key</dt>
                <dd>{data.bunny.accessKeyStatus}</dd>
              </div>
            </dl>
          </section>

          <section className="settingsCard" aria-labelledby="shopify-settings">
            <h2 id="shopify-settings">Shopify connection</h2>
            <dl className="settingsList">
              <div>
                <dt>Shop</dt>
                <dd>{data.shop}</dd>
              </div>
              <div>
                <dt>App URL</dt>
                <dd>{data.appUrl || "Not configured"}</dd>
              </div>
              <div>
                <dt>App proxy</dt>
                <dd>{data.appProxyPath}</dd>
              </div>
              <div>
                <dt>Theme block</dt>
                <dd>{data.operations.themeBlock}</dd>
              </div>
            </dl>
          </section>

          <section className="settingsCard" aria-labelledby="operations-settings">
            <h2 id="operations-settings">Operations</h2>
            <dl className="settingsList">
              <div>
                <dt>Order webhook</dt>
                <dd>{data.operations.orderWebhook}</dd>
              </div>
              <div>
                <dt>Cleanup command</dt>
                <dd><code>{data.operations.cleanupCommand}</code></dd>
              </div>
              <div>
                <dt>Storefront proxy</dt>
                <dd>{data.operations.appProxyTarget}</dd>
              </div>
              <div>
                <dt>Deployment</dt>
                <dd>Push app code to Railway. Deploy theme extension changes with Shopify CLI.</dd>
              </div>
            </dl>
          </section>
        </div>
      </s-section>
    </s-page>
  );
}

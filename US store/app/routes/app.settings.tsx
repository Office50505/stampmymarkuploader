import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { bunnyConfig } from "../lib/env.server";
import { authenticate } from "../shopify.server";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

const formatDateTime = (value: Date | null) =>
  value ? value.toLocaleString() : "No uploads yet";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const [uploadCount, latestUpload] = await Promise.all([
      prisma.upload.count({ where: { shop: session.shop } }),
      prisma.upload.findFirst({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      })
    ]);

    const cdnReady = Boolean(
      bunnyConfig.storageZone &&
        bunnyConfig.accessKey &&
        bunnyConfig.endpoint &&
        bunnyConfig.pullZoneUrl
    );

    return {
      database: {
        ok: true,
        title: "Healthy",
        message: "Upload records are being saved normally.",
        uploadCount,
        latestUploadAt: latestUpload?.createdAt.toISOString() ?? null
      },
      cdn: {
        ok: cdnReady,
        title: cdnReady ? "Ready" : "Needs attention",
        message: cdnReady
          ? "Customer files can be stored and previewed securely."
          : "File storage or preview delivery is not fully connected.",
        storageReady: Boolean(bunnyConfig.storageZone && bunnyConfig.accessKey),
        previewReady: Boolean(bunnyConfig.pullZoneUrl)
      }
    };
  } catch {
    return {
      database: {
        ok: false,
        title: "Needs attention",
        message: "Upload records could not be checked right now.",
        uploadCount: 0,
        latestUploadAt: null
      },
      cdn: {
        ok: false,
        title: "Not checked",
        message: "File delivery was not checked because the database check failed.",
        storageReady: false,
        previewReady: false
      }
    };
  }
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const latestUploadDate = data.database.latestUploadAt
    ? new Date(data.database.latestUploadAt)
    : null;

  return (
    <s-page>
      <TitleBar title="Settings" />
      <s-section heading="Settings">
        <div className="dashboardHero">
          <div>
            <h1>System health</h1>
            <p>Quick checks for the two things that matter most: saved uploads and file delivery.</p>
          </div>
          <Link className="primaryButton" to="/app/uploads">View uploads</Link>
        </div>

        <div className="healthGrid">
          <section className="healthCard" aria-labelledby="database-health">
            <div className="healthCardHeader">
              <div>
                <span className="healthEyebrow">Upload records</span>
                <h2 id="database-health">Database</h2>
              </div>
              <span className={data.database.ok ? "healthBadge ok" : "healthBadge warning"}>
                {data.database.title}
              </span>
            </div>
            <p>{data.database.message}</p>
            <dl className="healthFacts">
              <div>
                <dt>Total uploads</dt>
                <dd>{data.database.uploadCount}</dd>
              </div>
              <div>
                <dt>Latest upload</dt>
                <dd>{formatDateTime(latestUploadDate)}</dd>
              </div>
            </dl>
          </section>

          <section className="healthCard" aria-labelledby="cdn-health">
            <div className="healthCardHeader">
              <div>
                <span className="healthEyebrow">File previews</span>
                <h2 id="cdn-health">Bunny CDN</h2>
              </div>
              <span className={data.cdn.ok ? "healthBadge ok" : "healthBadge warning"}>
                {data.cdn.title}
              </span>
            </div>
            <p>{data.cdn.message}</p>
            <dl className="healthFacts">
              <div>
                <dt>File storage</dt>
                <dd>{data.cdn.storageReady ? "Connected" : "Needs setup"}</dd>
              </div>
              <div>
                <dt>Preview links</dt>
                <dd>{data.cdn.previewReady ? "Available" : "Needs setup"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </s-section>
    </s-page>
  );
}

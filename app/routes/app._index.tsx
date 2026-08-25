import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { createAdminFileUrl } from "../lib/uploads.server";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [all, ordered, unordered, expired, latestUploads] = await Promise.all([
    prisma.upload.count({ where: { shop } }),
    prisma.upload.count({ where: { shop, status: "ordered" } }),
    prisma.upload.count({
      where: { shop, status: { in: ["uploaded", "cart", "abandoned"] } }
    }),
    prisma.upload.count({ where: { shop, status: "expired" } }),
    prisma.upload.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  const latest = await Promise.all(
    latestUploads.map(async (upload) => {
      const file =
        upload.status !== "expired"
          ? await createAdminFileUrl({
              shop,
              uploadId: upload.uploadId,
              inline: true
            })
          : null;
      const preview = upload.contentType.startsWith("image/") ? file : null;

      return {
        uploadId: upload.uploadId,
        originalFilename: upload.originalFilename,
        contentType: upload.contentType,
        fileSize: Number(upload.fileSize),
        productTitle: upload.productTitle,
        selectedSize: upload.selectedSize,
        status: upload.status,
        uploadedAt: upload.uploadedAt?.toISOString() ?? null,
        previewUrl: preview?.url ?? null,
        fileUrl: file?.url ?? null
      };
    })
  );

  return {
    stats: { all, ordered, unordered, expired },
    latest
  };
};

export default function DashboardIndex() {
  const { stats, latest } = useLoaderData<typeof loader>();

  return (
    <s-page>
      <TitleBar title="StampMyMark uploader" />
      <s-section heading="Upload dashboard">
        <div className="dashboardHero">
          <div>
            <h1>StampMyMark uploads</h1>
            <p>Track artwork files as soon as customers upload them, before cart or checkout.</p>
          </div>
          <Link className="primaryButton" to="/app/uploads">View all uploads</Link>
        </div>

        <div className="statsGrid" aria-label="Upload summary">
          <Link className="statCard" to="/app/uploads">
            <span>All uploads</span>
            <strong>{stats.all}</strong>
          </Link>
          <Link className="statCard" to="/app/uploads?status=ordered">
            <span>Ordered</span>
            <strong>{stats.ordered}</strong>
          </Link>
          <Link className="statCard" to="/app/uploads?status=unordered">
            <span>Unordered</span>
            <strong>{stats.unordered}</strong>
          </Link>
          <Link className="statCard" to="/app/uploads?status=expired">
            <span>Expired</span>
            <strong>{stats.expired}</strong>
          </Link>
        </div>

        <div className="sectionHeader">
          <h2>Recent uploads</h2>
          <Link className="tableAction" to="/app/uploads">Open uploads</Link>
        </div>

        <div className="recentGrid">
          {latest.map((upload) => (
            <a
              className={upload.fileUrl ? "recentUpload" : "recentUpload isDisabled"}
              key={upload.uploadId}
              href={upload.fileUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={upload.fileUrl ? undefined : true}
            >
              <div className="thumb">
                {upload.previewUrl ? (
                  <img src={upload.previewUrl} alt="" loading="lazy" />
                ) : upload.contentType === "application/pdf" ? (
                  "PDF"
                ) : (
                  "File"
                )}
              </div>
              <div>
                <div className="fileName">{upload.originalFilename}</div>
                <div className="muted">{formatFileSize(upload.fileSize)}</div>
                <div className="muted">{upload.productTitle ?? "Unknown product"}</div>
                <div className="recentMeta">
                  <span className={`status ${upload.status}`}>{upload.status}</span>
                  {upload.selectedSize ? <span>{upload.selectedSize}</span> : null}
                </div>
              </div>
            </a>
          ))}
          {latest.length === 0 ? (
            <div className="emptyState">No uploads yet.</div>
          ) : null}
        </div>
      </s-section>
    </s-page>
  );
}

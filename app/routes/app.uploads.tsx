import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createAdminFileUrl, listUploads } from "../lib/uploads.server";
import adminStyles from "../styles/admin.css?url";

const filters = [
  ["all", "All"],
  ["ordered", "Ordered"],
  ["unordered", "Unordered/Abandoned"],
  ["expired", "Expired"]
] as const;

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "all";
  const query = url.searchParams.get("q") ?? "";
  const status =
    filter === "ordered" || filter === "expired" || filter === "unordered"
      ? filter
      : undefined;

  const uploads = await listUploads({
    shop: session.shop,
    status,
    query
  });

  const rows = await Promise.all(
    uploads.map(async (upload) => {
      const preview =
        upload.contentType.startsWith("image/") && upload.status !== "expired"
          ? await createAdminFileUrl({
              shop: session.shop,
              uploadId: upload.uploadId,
              inline: true
            })
          : null;

      return {
        uploadId: upload.uploadId,
        originalFilename: upload.originalFilename,
        contentType: upload.contentType,
        fileSize: Number(upload.fileSize),
        productTitle: upload.productTitle,
        productId: upload.productId,
        variantTitle: upload.variantTitle,
        variantId: upload.variantId,
        selectedSize: upload.selectedSize,
        quantity: upload.quantity,
        status: upload.status,
        uploadedAt: upload.uploadedAt?.toISOString() ?? null,
        createdAt: upload.createdAt.toISOString(),
        orderName: upload.orderName,
        orderId: upload.orderId,
        previewUrl: preview?.url ?? null
      };
    })
  );

  return { rows, filter, query };
};

export default function UploadsPage() {
  const { rows, filter, query } = useLoaderData<typeof loader>();

  return (
    <s-page>
      <TitleBar title="Uploads" />
      <s-section heading="Uploads">
        <div className="uploadsToolbar">
          <nav className="uploadFilters" aria-label="Upload filters">
            {filters.map(([value, label]) => {
              const href = value === "all" ? "/app/uploads" : `/app/uploads?status=${value}`;
              return (
                <Link
                  className="uploadFilter"
                  aria-current={filter === value ? "page" : undefined}
                  to={href}
                  key={value}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <span className="uploadCount">{rows.length} uploads</span>
        </div>

        {query ? <p className="muted">Filtering by "{query}"</p> : null}

        <div className="uploadTableWrap">
          <table className="uploadTable">
            <thead>
              <tr>
                <th className="colFile">File</th>
                <th className="colProduct">Product</th>
                <th className="colVariant">Variant / Size</th>
                <th className="colQty">Qty</th>
                <th className="colUploaded">Uploaded</th>
                <th className="colStatus">Status</th>
                <th className="colOrder">Order</th>
                <th className="colActions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.uploadId}>
                  <td>
                    <div className="uploadFile">
                      <div className="thumb">
                        {row.previewUrl ? (
                          <img
                            src={row.previewUrl}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.hidden = true;
                              event.currentTarget.parentElement?.classList.add("thumb--failed");
                            }}
                          />
                        ) : row.contentType === "application/pdf" ? (
                          "PDF"
                        ) : (
                          "File"
                        )}
                      </div>
                      <div className="uploadFileText">
                        <div className="fileName">{row.originalFilename}</div>
                        <div className="muted">{formatFileSize(row.fileSize)}</div>
                        <div className="muted">{row.uploadId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="tableText">{row.productTitle ?? row.productId ?? "Unknown"}</div>
                    {row.productId ? <div className="muted">{row.productId}</div> : null}
                  </td>
                  <td>
                    <div className="tableText">{row.variantTitle ?? row.variantId ?? "Unknown"}</div>
                    {row.selectedSize ? <div className="muted">Size: {row.selectedSize}</div> : null}
                  </td>
                  <td className="nowrap">{row.quantity ?? ""}</td>
                  <td className="nowrap">{row.uploadedAt ? new Date(row.uploadedAt).toLocaleString() : "Pending"}</td>
                  <td>
                    <span className={`status ${row.status}`}>{row.status}</span>
                  </td>
                  <td>{row.orderName ?? ""}</td>
                  <td>
                    <Link className="tableAction" to={`/app/uploads/${row.uploadId}`}>Open</Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>No uploads found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}

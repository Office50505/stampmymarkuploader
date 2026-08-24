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

        {query ? <p className="muted">Filtering by "{query}"</p> : null}

        <div className="uploadTableWrap">
          <table className="uploadTable">
            <thead>
              <tr>
                <th>File</th>
                <th>Product</th>
                <th>Variant / Size</th>
                <th>Qty</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.uploadId}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="thumb">
                        {row.previewUrl ? (
                          <img src={row.previewUrl} alt="" loading="lazy" />
                        ) : row.contentType === "application/pdf" ? (
                          "PDF"
                        ) : (
                          "File"
                        )}
                      </div>
                      <div>
                        <div className="fileName">{row.originalFilename}</div>
                        <div className="muted">{row.uploadId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{row.productTitle ?? row.productId ?? "Unknown"}</div>
                    {row.productId ? <div className="muted">{row.productId}</div> : null}
                  </td>
                  <td>
                    <div>{row.variantTitle ?? row.variantId ?? "Unknown"}</div>
                    {row.selectedSize ? <div className="muted">Size: {row.selectedSize}</div> : null}
                  </td>
                  <td>{row.quantity ?? ""}</td>
                  <td>{row.uploadedAt ? new Date(row.uploadedAt).toLocaleString() : "Pending"}</td>
                  <td>
                    <span className={`status ${row.status}`}>{row.status}</span>
                  </td>
                  <td>{row.orderName ?? ""}</td>
                  <td>
                    <Link to={`/app/uploads/${row.uploadId}`}>Open</Link>
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

import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createAdminFileUrl,
  getUploadForAdmin,
  listUploads
} from "../lib/uploads.server";
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
  const selectedUploadId = url.searchParams.get("selected") ?? "";
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

  const [all, ordered, unordered, expired] = await Promise.all([
    prisma.upload.count({ where: { shop: session.shop } }),
    prisma.upload.count({ where: { shop: session.shop, status: "ordered" } }),
    prisma.upload.count({
      where: {
        shop: session.shop,
        status: { in: ["uploaded", "cart", "abandoned"] }
      }
    }),
    prisma.upload.count({ where: { shop: session.shop, status: "expired" } })
  ]);

  const selectedUpload = selectedUploadId
    ? await getUploadForAdmin(session.shop, selectedUploadId)
    : null;
  const selectedInlineUrl =
    selectedUpload && selectedUpload.status !== "expired"
      ? await createAdminFileUrl({
          shop: session.shop,
          uploadId: selectedUpload.uploadId,
          inline: true
        })
      : null;
  const selectedDownloadUrl =
    selectedUpload && selectedUpload.status !== "expired"
      ? await createAdminFileUrl({
          shop: session.shop,
          uploadId: selectedUpload.uploadId,
          inline: false
        })
      : null;

  return {
    rows,
    filter,
    query,
    stats: { all, ordered, unordered, expired },
    selectedUpload: selectedUpload
      ? {
          uploadId: selectedUpload.uploadId,
          originalFilename: selectedUpload.originalFilename,
          contentType: selectedUpload.contentType,
          fileSize: Number(selectedUpload.fileSize),
          productTitle: selectedUpload.productTitle,
          productId: selectedUpload.productId,
          variantTitle: selectedUpload.variantTitle,
          variantId: selectedUpload.variantId,
          selectedSize: selectedUpload.selectedSize,
          quantity: selectedUpload.quantity,
          status: selectedUpload.status,
          uploadedAt: selectedUpload.uploadedAt?.toISOString() ?? null,
          createdAt: selectedUpload.createdAt.toISOString(),
          orderName: selectedUpload.orderName,
          orderId: selectedUpload.orderId,
          storageKey: selectedUpload.storageKey,
          previewUrl: selectedInlineUrl?.url ?? null,
          downloadUrl: selectedDownloadUrl?.url ?? null
        }
      : null
  };
};

export default function UploadsPage() {
  const { rows, filter, query, stats, selectedUpload } = useLoaderData<typeof loader>();
  const activeSelectedId = selectedUpload?.uploadId ?? "";
  const filterSearch = filter === "all" ? "" : `&status=${filter}`;
  const querySearch = query ? `&q=${encodeURIComponent(query)}` : "";

  return (
    <s-page>
      <TitleBar title="Uploads" />
      <s-section heading="Uploads">
        <div className="statsGrid" aria-label="Upload summary">
          <Link className="statCard" to="/app/uploads">
            <span>All</span>
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

        <Form method="get" className="uploadSearch" role="search">
          {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
          <input
            className="uploadSearchInput"
            type="search"
            name="q"
            placeholder="Search filename, upload ID, product, or order"
            defaultValue={query}
          />
          <button className="secondaryButton" type="submit">Search</button>
          {query ? <Link className="secondaryButton" to={filter === "all" ? "/app/uploads" : `/app/uploads?status=${filter}`}>Clear</Link> : null}
        </Form>

        {query ? <p className="muted">Filtering by "{query}"</p> : null}

        <div className={selectedUpload ? "uploadsLayout hasDetail" : "uploadsLayout"}>
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
                {rows.map((row) => {
                  const selectedHref =
                    `/app/uploads?selected=${encodeURIComponent(row.uploadId)}` +
                    filterSearch +
                    querySearch;
                  return (
                    <tr
                      className={activeSelectedId === row.uploadId ? "isSelected" : undefined}
                      key={row.uploadId}
                    >
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
                        <Link className="tableAction" to={selectedHref}>View</Link>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No uploads found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {selectedUpload ? (
            <aside className="uploadDetailPanel" aria-label="Selected upload details">
              <div className="detailPanelHeader">
                <div>
                  <h2>{selectedUpload.originalFilename}</h2>
                  <p>{selectedUpload.uploadId}</p>
                </div>
                <Link className="panelClose" to={`/app/uploads${filter === "all" ? "" : `?status=${filter}`}${query ? `${filter === "all" ? "?" : "&"}q=${encodeURIComponent(query)}` : ""}`}>Close</Link>
              </div>

              <div className="panelPreview">
                {selectedUpload.previewUrl && selectedUpload.contentType.startsWith("image/") ? (
                  <img src={selectedUpload.previewUrl} alt={selectedUpload.originalFilename} />
                ) : (
                  <div className="detailFileTile">
                    {selectedUpload.contentType === "application/pdf" ? "PDF" : "File"}
                  </div>
                )}
              </div>

              <div className="detailActions">
                {selectedUpload.previewUrl ? (
                  <a className="primaryButton" href={selectedUpload.previewUrl} target="_blank" rel="noreferrer">View original</a>
                ) : null}
                {selectedUpload.downloadUrl ? (
                  <a className="secondaryButton" href={selectedUpload.downloadUrl} target="_blank" rel="noreferrer">Download</a>
                ) : null}
              </div>

              <dl className="detailList">
                <div><dt>Status</dt><dd><span className={`status ${selectedUpload.status}`}>{selectedUpload.status}</span></dd></div>
                <div><dt>File size</dt><dd>{formatFileSize(selectedUpload.fileSize)}</dd></div>
                <div><dt>Type</dt><dd>{selectedUpload.contentType}</dd></div>
                <div><dt>Product</dt><dd>{selectedUpload.productTitle ?? selectedUpload.productId ?? "Unknown"}</dd></div>
                <div><dt>Variant</dt><dd>{selectedUpload.variantTitle ?? selectedUpload.variantId ?? "Unknown"}</dd></div>
                <div><dt>Size</dt><dd>{selectedUpload.selectedSize ?? ""}</dd></div>
                <div><dt>Quantity</dt><dd>{selectedUpload.quantity ?? ""}</dd></div>
                <div><dt>Uploaded</dt><dd>{selectedUpload.uploadedAt ? new Date(selectedUpload.uploadedAt).toLocaleString() : "Pending"}</dd></div>
                <div><dt>Order</dt><dd>{selectedUpload.orderName ?? ""}</dd></div>
                <div><dt>Storage key</dt><dd>{selectedUpload.storageKey}</dd></div>
              </dl>
            </aside>
          ) : null}
        </div>
      </s-section>
    </s-page>
  );
}

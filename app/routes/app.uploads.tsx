import type { KeyboardEvent, MouseEvent } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  countUploads,
  createAdminFileUrl,
  getUploadForAdmin,
  listUploads
} from "../lib/uploads.server";
import adminStyles from "../styles/admin.css?url";

const filters = [
  ["all", "All"],
  ["ordered", "Ordered"],
  ["unordered", "Unordered"],
  ["cart", "In cart"],
  ["abandoned", "Abandoned"],
  ["expired", "Expired"]
] as const;
const pageSize = 10;
type UploadFilter = (typeof filters)[number][0];

const isUploadFilter = (value: string): value is UploadFilter =>
  filters.some(([filterValue]) => filterValue === value);

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const parseDateFilter = (value: string | null, endOfDay = false) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const getQuickRanges = () => {
  const today = new Date();
  const last7 = new Date(today);
  const last30 = new Date(today);

  last7.setUTCDate(today.getUTCDate() - 6);
  last30.setUTCDate(today.getUTCDate() - 29);

  return [
    { label: "Today", dateFrom: toDateInputValue(today), dateTo: toDateInputValue(today) },
    { label: "7 days", dateFrom: toDateInputValue(last7), dateTo: toDateInputValue(today) },
    { label: "30 days", dateFrom: toDateInputValue(last30), dateTo: toDateInputValue(today) },
    { label: "All time", dateFrom: "", dateTo: "" }
  ];
};

const statusLabels: Record<string, string> = {
  uploaded: "Unordered",
  cart: "In cart",
  abandoned: "Abandoned",
  ordered: "Ordered",
  expired: "Expired"
};

const formatStatus = (status: string) => statusLabels[status] ?? status;

const shortenUploadId = (uploadId: string) =>
  uploadId.length > 14 ? `${uploadId.slice(0, 10)}...${uploadId.slice(-4)}` : uploadId;

const formatIpLocation = (row: {
  ipCity: string | null;
  ipRegion: string | null;
  ipCountry: string | null;
  ipCountryCode: string | null;
  ipAsn: string | null;
}) => {
  const parts = [
    row.ipCity,
    row.ipRegion,
    row.ipCountry || row.ipCountryCode
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(", ");
  }

  return row.ipAsn || "Unknown";
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedFilter = url.searchParams.get("status") ?? "all";
  const filter = isUploadFilter(requestedFilter) ? requestedFilter : "all";
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const dateFromValue = url.searchParams.get("dateFrom") ?? "";
  const dateToValue = url.searchParams.get("dateTo") ?? "";
  const dateFrom = parseDateFilter(dateFromValue);
  const dateTo = parseDateFilter(dateToValue, true);
  const selectedUploadId = url.searchParams.get("selected") ?? "";
  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const status = filter === "all" ? undefined : filter;
  const totalUploads = await countUploads({
    shop: session.shop,
    status,
    query,
    dateFrom,
    dateTo
  });
  const totalPages = Math.max(1, Math.ceil(totalUploads / pageSize));
  const page = Math.min(
    totalPages,
    Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1)
  );

  const uploads = await listUploads({
    shop: session.shop,
    status,
    query,
    dateFrom,
    dateTo,
    page,
    pageSize
  });

  const rows = await Promise.all(
    uploads.map(async (upload) => {
      const file =
        upload.status !== "expired"
          ? await createAdminFileUrl({
              shop: session.shop,
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
        productId: upload.productId,
        variantTitle: upload.variantTitle,
        variantId: upload.variantId,
        selectedSize: upload.selectedSize,
        quantity: upload.quantity,
        status: upload.status,
        uploadedAt: upload.uploadedAt?.toISOString() ?? null,
        createdAt: upload.createdAt.toISOString(),
        ipAddress: upload.ipAddress,
        ipCity: upload.ipCity,
        ipRegion: upload.ipRegion,
        ipRegionCode: upload.ipRegionCode,
        ipPostalCode: upload.ipPostalCode,
        ipCountryCode: upload.ipCountryCode,
        ipCountry: upload.ipCountry,
        ipContinent: upload.ipContinent,
        ipAsn: upload.ipAsn,
        ipAsName: upload.ipAsName,
        orderName: upload.orderName,
        orderId: upload.orderId,
        previewUrl: preview?.url ?? null,
        fileUrl: file?.url ?? null
      };
    })
  );

  const [all, ordered, unordered, inCart, abandoned, expired] = await Promise.all([
    prisma.upload.count({ where: { shop: session.shop } }),
    prisma.upload.count({ where: { shop: session.shop, status: "ordered" } }),
    prisma.upload.count({
      where: {
        shop: session.shop,
        status: { in: ["uploaded", "cart", "abandoned"] }
      }
    }),
    prisma.upload.count({ where: { shop: session.shop, status: "cart" } }),
    prisma.upload.count({ where: { shop: session.shop, status: "abandoned" } }),
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
    dateFrom: dateFromValue,
    dateTo: dateToValue,
    quickRanges: getQuickRanges(),
    pagination: {
      page,
      pageSize,
      totalUploads,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages
    },
    stats: { all, ordered, unordered, inCart, abandoned, expired },
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
          ipAddress: selectedUpload.ipAddress,
          ipCity: selectedUpload.ipCity,
          ipRegion: selectedUpload.ipRegion,
          ipRegionCode: selectedUpload.ipRegionCode,
          ipPostalCode: selectedUpload.ipPostalCode,
          ipCountryCode: selectedUpload.ipCountryCode,
          ipCountry: selectedUpload.ipCountry,
          ipContinent: selectedUpload.ipContinent,
          ipAsn: selectedUpload.ipAsn,
          ipAsName: selectedUpload.ipAsName,
          textAbove: selectedUpload.textAbove,
          textBelow: selectedUpload.textBelow,
          designerNotes: selectedUpload.designerNotes,
          orderName: selectedUpload.orderName,
          orderId: selectedUpload.orderId,
          previewUrl: selectedInlineUrl?.url ?? null,
          downloadUrl: selectedDownloadUrl?.url ?? null
        }
      : null
  };
};

export default function UploadsPage() {
  const {
    rows,
    filter,
    query,
    dateFrom,
    dateTo,
    quickRanges,
    pagination,
    stats,
    selectedUpload
  } = useLoaderData<typeof loader>();
  const activeSelectedId = selectedUpload?.uploadId ?? "";
  const shouldIgnoreRowActivation = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest("a, button, input, select, textarea"));
  const openUploadRow = (href: string, event: MouseEvent<HTMLTableRowElement>) => {
    if (!href || shouldIgnoreRowActivation(event.target)) {
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  };
  const openUploadRowFromKeyboard = (
    href: string,
    event: KeyboardEvent<HTMLTableRowElement>
  ) => {
    if (
      !href ||
      shouldIgnoreRowActivation(event.target) ||
      (event.key !== "Enter" && event.key !== " ")
    ) {
      return;
    }

    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  };
  const buildUploadsHref = ({
    nextFilter = filter,
    nextQuery = query,
    nextDateFrom = dateFrom,
    nextDateTo = dateTo,
    nextPage = pagination.page,
    selected
  }: {
    nextFilter?: string;
    nextQuery?: string;
    nextDateFrom?: string;
    nextDateTo?: string;
    nextPage?: number;
    selected?: string | null;
  } = {}) => {
    const params = new URLSearchParams();

    if (nextFilter !== "all") {
      params.set("status", nextFilter);
    }

    if (nextQuery) {
      params.set("q", nextQuery);
    }

    if (nextDateFrom) {
      params.set("dateFrom", nextDateFrom);
    }

    if (nextDateTo) {
      params.set("dateTo", nextDateTo);
    }

    if (nextPage > 1) {
      params.set("page", String(nextPage));
    }

    if (selected) {
      params.set("selected", selected);
    }

    const search = params.toString();
    return `/app/uploads${search ? `?${search}` : ""}`;
  };

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
          <Link className="statCard" to="/app/uploads?status=cart">
            <span>In cart</span>
            <strong>{stats.inCart}</strong>
          </Link>
          <Link className="statCard" to="/app/uploads?status=abandoned">
            <span>Abandoned</span>
            <strong>{stats.abandoned}</strong>
          </Link>
          <Link className="statCard" to="/app/uploads?status=expired">
            <span>Expired</span>
            <strong>{stats.expired}</strong>
          </Link>
        </div>

        <div className="uploadsToolbar">
          <nav className="uploadFilters" aria-label="Upload filters">
            {filters.map(([value, label]) => {
              return (
                <Link
                  className="uploadFilter"
                  aria-current={filter === value ? "page" : undefined}
                  to={buildUploadsHref({
                    nextFilter: value,
                    nextQuery: "",
                    nextDateFrom: "",
                    nextDateTo: "",
                    nextPage: 1,
                    selected: null
                  })}
                  key={value}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <span className="uploadCount">
            Showing {rows.length} of {pagination.totalUploads} uploads
          </span>
        </div>

        <Form method="get" className="uploadSearch" role="search">
          {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
          <div className="filterField searchField">
            <label htmlFor="upload-search">Search</label>
            <input
              id="upload-search"
              className="uploadSearchInput"
              type="search"
              name="q"
              placeholder="Filename, upload ID, product, or order"
              defaultValue={query}
            />
          </div>
          <div className="dateFilterGroup" aria-label="Upload date range">
            <div className="datePillField">
              <label htmlFor="upload-date-from">From</label>
              <input
                id="upload-date-from"
                className="datePillInput"
                type="date"
                name="dateFrom"
                defaultValue={dateFrom}
              />
            </div>
            <div className="datePillField">
              <label htmlFor="upload-date-to">To</label>
              <input
                id="upload-date-to"
                className="datePillInput"
                type="date"
                name="dateTo"
                defaultValue={dateTo}
              />
            </div>
          </div>
          <button className="secondaryButton" type="submit">Search</button>
          {query || dateFrom || dateTo ? (
            <Link
              className="secondaryButton"
              to={buildUploadsHref({
                nextQuery: "",
                nextDateFrom: "",
                nextDateTo: "",
                nextPage: 1,
                selected: null
              })}
            >
              Clear
            </Link>
          ) : null}
        </Form>

        <div className="quickFilters" aria-label="Quick date filters">
          {quickRanges.map((range) => {
            const isActive = dateFrom === range.dateFrom && dateTo === range.dateTo;

            return (
              <Link
                className="quickFilter"
                aria-current={isActive ? "page" : undefined}
                key={range.label}
                to={buildUploadsHref({
                  nextDateFrom: range.dateFrom,
                  nextDateTo: range.dateTo,
                  nextPage: 1,
                  selected: null
                })}
              >
                {range.label}
              </Link>
            );
          })}
        </div>

        {query || dateFrom || dateTo ? (
          <p className="muted">
            Filtering
            {query ? ` by "${query}"` : ""}
            {dateFrom ? ` from ${dateFrom}` : ""}
            {dateTo ? ` to ${dateTo}` : ""}
          </p>
        ) : null}

        <div className={selectedUpload ? "uploadsLayout hasDetail" : "uploadsLayout"}>
          <div className="uploadTableWrap">
            <div className="feedHeader">
              <div>
                <h2>Upload feed</h2>
                <p>{rows.length} visible · Click a row to open the file</p>
              </div>
              <div className="feedActions">
                <Link className="secondaryButton" to={buildUploadsHref({ selected: null })}>
                  Refresh
                </Link>
                <div className="paginationBar" aria-label="Upload pagination">
                  <span className="pageStatus">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <div className="pageControls">
                    {pagination.hasPrevious ? (
                      <Link
                        className="pageArrow"
                        aria-label="Previous page"
                        to={buildUploadsHref({
                          nextPage: pagination.page - 1,
                          selected: null
                        })}
                      >
                        ‹
                      </Link>
                    ) : (
                      <span className="pageArrow isDisabled" aria-hidden="true">‹</span>
                    )}
                    {pagination.hasNext ? (
                      <Link
                        className="pageArrow"
                        aria-label="Next page"
                        to={buildUploadsHref({
                          nextPage: pagination.page + 1,
                          selected: null
                        })}
                      >
                        ›
                      </Link>
                    ) : (
                      <span className="pageArrow isDisabled" aria-hidden="true">›</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <table className="uploadTable">
              <thead>
                <tr>
                  <th className="colIndex">#</th>
                  <th className="colFile">File</th>
                  <th className="colProduct">Product</th>
                  <th className="colVariant">Variant / Size</th>
                  <th className="colQty">Qty</th>
                  <th className="colLocation">IP location</th>
                  <th className="colStatus">Status</th>
                  <th className="colOrder">Order</th>
                  <th className="colActions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const fileHref = row.fileUrl ?? "";
                  const displayIndex =
                    (pagination.page - 1) * pagination.pageSize + rowIndex + 1;

                  return (
                    <tr
                      className={
                        activeSelectedId === row.uploadId
                          ? `isSelected${fileHref ? " isClickable" : ""}`
                          : fileHref
                            ? "isClickable"
                            : undefined
                      }
                      key={row.uploadId}
                      onClick={(event) => openUploadRow(fileHref, event)}
                      onKeyDown={(event) => openUploadRowFromKeyboard(fileHref, event)}
                      role={fileHref ? "link" : undefined}
                      tabIndex={fileHref ? 0 : undefined}
                    >
                      <td className="indexCell">{displayIndex}</td>
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
                            <div className="fileName" title={row.originalFilename}>
                              {row.originalFilename}
                            </div>
                            <div className="muted">{formatFileSize(row.fileSize)}</div>
                            <div className="muted">ID {shortenUploadId(row.uploadId)}</div>
                            {row.fileUrl ? (
                              <a
                                className="inlineAction"
                                href={row.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {row.contentType.startsWith("image/") ? "Open photo" : "Open file"}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div
                          className="tableText"
                          title={row.productTitle ?? row.productId ?? "Unknown"}
                        >
                          {row.productTitle ?? row.productId ?? "Unknown"}
                        </div>
                        {row.productId ? <div className="muted">{row.productId}</div> : null}
                      </td>
                      <td>
                        <div
                          className="tableText"
                          title={row.variantTitle ?? row.variantId ?? "Unknown"}
                        >
                          {row.variantTitle ?? row.variantId ?? "Unknown"}
                        </div>
                        {row.selectedSize ? <div className="muted">Size: {row.selectedSize}</div> : null}
                      </td>
                      <td className="nowrap">{row.quantity ?? ""}</td>
                      <td>
                        <div
                          className="tableText"
                          title={row.ipAddress ?? formatIpLocation(row)}
                        >
                          {formatIpLocation(row)}
                        </div>
                        {row.ipAddress ? <div className="muted">{row.ipAddress}</div> : null}
                      </td>
                      <td>
                        <span className={`status ${row.status}`}>{formatStatus(row.status)}</span>
                      </td>
                      <td>{row.orderName ?? ""}</td>
                      <td>
                        {row.fileUrl ? (
                          <a
                            className="tableAction"
                            href={row.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="tableEmpty">No uploads match these filters.</div>
                    </td>
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
                <Link className="panelClose" to={buildUploadsHref({ selected: null })}>Close</Link>
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

              {selectedUpload.textAbove || selectedUpload.textBelow || selectedUpload.designerNotes ? (
                <section className="detailNotes" aria-label="Customer personalization text">
                  <h3>Customer text</h3>
                  {selectedUpload.textAbove ? (
                    <div>
                      <span>Above</span>
                      <p>{selectedUpload.textAbove}</p>
                    </div>
                  ) : null}
                  {selectedUpload.textBelow ? (
                    <div>
                      <span>Below</span>
                      <p>{selectedUpload.textBelow}</p>
                    </div>
                  ) : null}
                  {selectedUpload.designerNotes ? (
                    <div>
                      <span>Notes</span>
                      <p>{selectedUpload.designerNotes}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <dl className="detailList">
                <div><dt>Status</dt><dd><span className={`status ${selectedUpload.status}`}>{formatStatus(selectedUpload.status)}</span></dd></div>
                <div><dt>File size</dt><dd>{formatFileSize(selectedUpload.fileSize)}</dd></div>
                <div><dt>Type</dt><dd>{selectedUpload.contentType}</dd></div>
                <div><dt>Product</dt><dd>{selectedUpload.productTitle ?? selectedUpload.productId ?? "Unknown"}</dd></div>
                <div><dt>Variant</dt><dd>{selectedUpload.variantTitle ?? selectedUpload.variantId ?? "Unknown"}</dd></div>
                <div><dt>Size</dt><dd>{selectedUpload.selectedSize ?? ""}</dd></div>
                <div><dt>Quantity</dt><dd>{selectedUpload.quantity ?? ""}</dd></div>
                <div><dt>Uploaded</dt><dd>{selectedUpload.uploadedAt ? new Date(selectedUpload.uploadedAt).toLocaleString() : "Pending"}</dd></div>
                <div><dt>IP location</dt><dd>{formatIpLocation(selectedUpload)}</dd></div>
                <div><dt>IP address</dt><dd>{selectedUpload.ipAddress ?? "Unknown"}</dd></div>
                <div><dt>Network</dt><dd>{selectedUpload.ipAsName ?? selectedUpload.ipAsn ?? "Unknown"}</dd></div>
                <div><dt>Order</dt><dd>{selectedUpload.orderName ?? ""}</dd></div>
              </dl>
            </aside>
          ) : null}
        </div>
      </s-section>
    </s-page>
  );
}

import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createAdminFileUrl, getUploadForAdmin } from "../lib/uploads.server";
import adminStyles from "../styles/admin.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminStyles }
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const uploadId = params.uploadId || "";
  const upload = await getUploadForAdmin(session.shop, uploadId);

  if (!upload) {
    throw new Response("Upload not found", { status: 404 });
  }

  const fileUrl =
    upload.status !== "expired"
      ? await createAdminFileUrl({
          shop: session.shop,
          uploadId,
          inline: true
        })
      : null;

  return {
    upload: {
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
      storageKey: upload.storageKey
    },
    fileUrl: fileUrl?.url ?? null
  };
};

export default function UploadDetailPage() {
  const { upload, fileUrl } = useLoaderData<typeof loader>();
  const isImage = upload.contentType.startsWith("image/");

  return (
    <s-page>
      <TitleBar title={upload.originalFilename} />
      <s-section heading="Upload details">
        <p>
          <Link to="/app/uploads">Back to uploads</Link>
        </p>
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)" }}>
          <div>
            {fileUrl && isImage ? (
              <img
                src={fileUrl}
                alt={upload.originalFilename}
                style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #e5e7eb" }}
              />
            ) : (
              <div className="thumb" style={{ width: 160, height: 160 }}>
                {upload.contentType === "application/pdf" ? "PDF" : "File"}
              </div>
            )}
          </div>
          <div>
            <table className="uploadTable" style={{ minWidth: 0 }}>
              <tbody>
                <tr><th>Upload ID</th><td>{upload.uploadId}</td></tr>
                <tr><th>Filename</th><td>{upload.originalFilename}</td></tr>
                <tr><th>Type</th><td>{upload.contentType}</td></tr>
                <tr><th>Size</th><td>{Math.round(upload.fileSize / 1024)} KB</td></tr>
                <tr><th>Status</th><td><span className={`status ${upload.status}`}>{upload.status}</span></td></tr>
                <tr><th>Product</th><td>{upload.productTitle ?? upload.productId ?? ""}</td></tr>
                <tr><th>Variant</th><td>{upload.variantTitle ?? upload.variantId ?? ""}</td></tr>
                <tr><th>Size</th><td>{upload.selectedSize ?? ""}</td></tr>
                <tr><th>Quantity</th><td>{upload.quantity ?? ""}</td></tr>
                <tr><th>Uploaded</th><td>{upload.uploadedAt ? new Date(upload.uploadedAt).toLocaleString() : "Pending"}</td></tr>
                <tr><th>Order</th><td>{upload.orderName ?? ""}</td></tr>
                <tr><th>Storage key</th><td>{upload.storageKey}</td></tr>
              </tbody>
            </table>
            {fileUrl ? (
              <p>
                <a href={fileUrl} target="_blank" rel="noreferrer">View original</a>
                {" | "}
                <a href={`/app/uploads/${upload.uploadId}/download-url`} target="_blank" rel="noreferrer">Download original</a>
              </p>
            ) : null}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

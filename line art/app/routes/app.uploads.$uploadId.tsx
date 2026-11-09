import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  createAdminFileUrl,
  createAdminLineArtFileUrl,
  getUploadForAdmin
} from "../lib/uploads.server";
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

  const [fileUrl, lineArtInlineUrl, lineArtDownloadUrl] =
    upload.status !== "expired"
      ? await Promise.all([
          createAdminFileUrl({ shop: session.shop, uploadId, inline: true }),
          createAdminLineArtFileUrl({ shop: session.shop, uploadId, inline: true }),
          createAdminLineArtFileUrl({ shop: session.shop, uploadId, inline: false })
        ])
      : [null, null, null];

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
      textAbove: upload.textAbove,
      textBelow: upload.textBelow,
      designerNotes: upload.designerNotes,
      orderName: upload.orderName,
      orderId: upload.orderId,
      lineArtStatus: upload.lineArtStatus,
      lineArtColor: upload.lineArtColor,
      lineArtModel: upload.lineArtModel,
      lineArtGeneratedAt: upload.lineArtGeneratedAt?.toISOString() ?? null,
      lineArtError: upload.lineArtError
    },
    fileUrl: fileUrl?.url ?? null,
    lineArtUrl: lineArtInlineUrl?.url ?? null,
    lineArtDownloadUrl: lineArtDownloadUrl?.url ?? null
  };
};

export default function UploadDetailPage() {
  const { upload, fileUrl, lineArtUrl, lineArtDownloadUrl } = useLoaderData<typeof loader>();
  const isImage = upload.contentType.startsWith("image/");

  return (
    <s-page>
      <TitleBar title={upload.originalFilename} />
      <s-section heading="Upload details">
        <p>
          <Link to="/app/uploads">Back to uploads</Link>
        </p>
        <div className="uploadDetailGrid">
          <div>
            {lineArtUrl ? (
              <>
                <h3>Generated line art</h3>
                <img
                  src={lineArtUrl}
                  alt={`Generated ${upload.lineArtColor ?? ""} line art`}
                  className="detailPreview lineArtPreview"
                />
                <h3>Original upload</h3>
              </>
            ) : null}
            {fileUrl && isImage ? (
              <img
                src={fileUrl}
                alt={upload.originalFilename}
                className="detailPreview"
              />
            ) : (
              <div className="detailFileTile">
                {upload.contentType === "application/pdf" ? "PDF" : "File"}
              </div>
            )}
          </div>
          <div>
            <table className="detailTable">
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
                <tr><th>Above</th><td>{upload.textAbove ?? ""}</td></tr>
                <tr><th>Below</th><td>{upload.textBelow ?? ""}</td></tr>
                <tr><th>Notes</th><td>{upload.designerNotes ?? ""}</td></tr>
                <tr><th>Line art</th><td>{upload.lineArtStatus}</td></tr>
                <tr><th>Ink color</th><td>{upload.lineArtColor ?? ""}</td></tr>
                <tr><th>Image model</th><td>{upload.lineArtModel ?? ""}</td></tr>
                <tr><th>Generated</th><td>{upload.lineArtGeneratedAt ? new Date(upload.lineArtGeneratedAt).toLocaleString() : ""}</td></tr>
                <tr><th>Generation error</th><td>{upload.lineArtError ?? ""}</td></tr>
                <tr><th>Uploaded</th><td>{upload.uploadedAt ? new Date(upload.uploadedAt).toLocaleString() : "Pending"}</td></tr>
                <tr><th>Order</th><td>{upload.orderName ?? ""}</td></tr>
              </tbody>
            </table>
            {fileUrl ? (
              <div className="detailActions">
                <a className="tableAction" href={fileUrl} target="_blank" rel="noreferrer">View original</a>
                <a className="tableAction" href={`/app/uploads/${upload.uploadId}/download-url`} target="_blank" rel="noreferrer">Download original</a>
              </div>
            ) : null}
            {lineArtUrl ? (
              <div className="detailActions">
                <a className="tableAction" href={lineArtUrl} target="_blank" rel="noreferrer">View line art</a>
                <a className="tableAction" href={lineArtDownloadUrl ?? lineArtUrl} target="_blank" rel="noreferrer">Download line art</a>
              </div>
            ) : null}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

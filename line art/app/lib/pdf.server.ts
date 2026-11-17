import {
  DOMMatrix,
  DOMPoint,
  DOMRect,
  ImageData,
  Path2D,
  createCanvas
} from "@napi-rs/canvas";
import { join } from "node:path";

const pdfGlobals = globalThis as Record<string, unknown>;
pdfGlobals.DOMMatrix ??= DOMMatrix;
pdfGlobals.DOMPoint ??= DOMPoint;
pdfGlobals.DOMRect ??= DOMRect;
pdfGlobals.ImageData ??= ImageData;
pdfGlobals.Path2D ??= Path2D;

const maxRenderedEdge = 2400;
const standardFontDataUrl = `${join(
  process.cwd(),
  "node_modules/pdfjs-dist/standard_fonts"
)}/`;

export const renderPdfFirstPageToPng = async (body: Buffer) => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(body),
    disableFontFace: true,
    standardFontDataUrl,
    useSystemFonts: false
  });
  const document = await loadingTask.promise;

  try {
    if (document.numPages < 1) {
      throw new Error("The PDF does not contain a page to process.");
    }

    const page = await document.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      3,
      maxRenderedEdge / Math.max(baseViewport.width, baseViewport.height)
    );
    const viewport = page.getViewport({ scale: Math.max(1, scale) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as never,
      viewport
    }).promise;

    return canvas.toBuffer("image/png");
  } finally {
    await loadingTask.destroy();
  }
};

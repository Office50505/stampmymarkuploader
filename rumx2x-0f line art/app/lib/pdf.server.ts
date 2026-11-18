import { parseHTML } from "linkedom";
import { join } from "node:path";
import sharp from "sharp";

const maxRenderedEdge = 2400;
const standardFontDataUrl = `${join(
  process.cwd(),
  "node_modules/pdfjs-dist/standard_fonts"
)}/`;

// PDF.js's Node canvas renderer relies on native Skia bindings. Those bindings
// can terminate the whole Railway process for some customer PDFs. Rendering
// the first page through PDF.js's SVG backend keeps PDF parsing and drawing in
// JavaScript, then lets the already-installed Sharp/libvips pipeline rasterize
// the SVG to the PNG used by the rest of the line-art flow.
const svgNamespace = "http://www.w3.org/2000/svg";
const xlinkNamespace = "http://www.w3.org/1999/xlink";
let pdfRenderQueue = Promise.resolve();

const toSvgMarkup = (svg: { outerHTML: string }) =>
  svg.outerHTML
    .replace(
      "<svg:svg ",
      `<svg:svg xmlns:svg="${svgNamespace}" xmlns:xlink="${xlinkNamespace}" `
    )
    .replace(/<svg:/g, "<")
    .replace(/<\/svg:/g, "</");

export const renderPdfFirstPageToPng = async (body: Buffer) => {
  const render = pdfRenderQueue.then(() => renderPdfFirstPageToPngUnsafe(body));
  pdfRenderQueue = render.then(
    () => undefined,
    () => undefined
  );
  return render;
};

const renderPdfFirstPageToPngUnsafe = async (body: Buffer) => {
  const { document } = parseHTML("<html><body></body></html>");
  const globalWithDocument = globalThis as { document?: unknown };
  const previousDocument = globalWithDocument.document;
  globalWithDocument.document = document;

  try {
    const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.js");
    const { getDocument, SVGGraphics } =
      (pdfjsModule.default ?? pdfjsModule) as typeof pdfjsModule;
    const loadingTask = getDocument({
      data: new Uint8Array(body),
      disableFontFace: true,
      standardFontDataUrl,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false
    });
    const pdfDocument = await loadingTask.promise;

    try {
      if (pdfDocument.numPages < 1) {
        throw new Error("The PDF does not contain a page to process.");
      }

      const page = await pdfDocument.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        3,
        maxRenderedEdge / Math.max(baseViewport.width, baseViewport.height)
      );
      const viewport = page.getViewport({ scale: Math.max(1, scale) });
      const operatorList = await page.getOperatorList();
      const graphics = new SVGGraphics(page.commonObjs, page.objs, true);
      const svg = (await graphics.getSVG(operatorList, viewport)) as unknown as {
        outerHTML: string;
      };
      const svgMarkup = toSvgMarkup(svg);

      return sharp(Buffer.from(svgMarkup)).png().toBuffer();
    } finally {
      await loadingTask.destroy();
    }
  } finally {
    if (previousDocument === undefined) {
      delete globalWithDocument.document;
    } else {
      globalWithDocument.document = previousDocument;
    }
  }
};

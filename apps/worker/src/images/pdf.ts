import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { ImageRejected } from "./rejected.js";

/*
 * PDF to a PNG of its first page, in-process with pdf.js and @napi-rs/canvas. The alternative,
 * `pdftoppm`, needs poppler in the worker image, whose runtime stage removes `apk` on purpose and
 * stays a bare Alpine + stripped node. pdf.js is pure JavaScript plus one prebuilt canvas binary
 * (musl build available), so the image gains no system packages.
 */

/** 200 dpi: the PDF unit is 1/72 inch. */
const RENDER_SCALE = 200 / 72;
/** Longest edge of the raster, so a poster-sized page cannot exhaust memory. */
const MAX_RASTER_EDGE = 4096;

interface CanvasFactory {
  create: (
    width: number,
    height: number,
  ) => {
    canvas: { toBuffer: (mime: "image/png") => Buffer };
    context: unknown;
  };
}

let assetBase: string | undefined;

/** pdf.js loads fonts, CMaps and wasm decoders by URL; in Node that is a directory path with a trailing slash. */
function assetUrl(directory: string): string {
  assetBase ??= dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  return `${join(assetBase, directory)}/`;
}

/**
 * Rasterizes the only page of a PDF. A PDF with more pages is refused for now: a `files` row holds
 * one image (`r2_key`), and several pages would need a page table (reported in phase2.md Notes).
 */
export async function rasterizePdf(pdf: Buffer): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // Nothing in a prescription needs scripts or system fonts.
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    standardFontDataUrl: assetUrl("standard_fonts"),
    cMapUrl: assetUrl("cmaps"),
    iccUrl: assetUrl("iccs"),
    wasmUrl: assetUrl("wasm"),
    verbosity: 0,
  });
  try {
    const document = await loading.promise.catch(() => {
      throw new ImageRejected("pdf_unreadable");
    });
    if (document.numPages > 1) throw new ImageRejected("pdf_multi_page_unsupported");
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(RENDER_SCALE, MAX_RASTER_EDGE / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale });
    const factory = document.canvasFactory as CanvasFactory;
    const { canvas, context } = factory.create(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" } as never)
      .promise;
    return canvas.toBuffer("image/png");
  } catch (error) {
    if (error instanceof ImageRejected) throw error;
    throw new ImageRejected("pdf_unreadable");
  } finally {
    await loading.destroy();
  }
}

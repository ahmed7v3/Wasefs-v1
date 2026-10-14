import { PDF_MAX_PAGES, PROCESSED_LONG_EDGE } from "@wasfa/shared/schemas/files";

/*
 * PDF pages become JPEG pictures in the browser: the server accepts only single-page PDFs (and
 * those are read by the worker), so a multi-page prescription PDF is split here. pdf.js is loaded
 * on demand (dynamic import), never in the main bundle.
 */

export function isPdfFile(file: Pick<File, "type" | "name">): boolean {
  return file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
}

/** Intermediate JPEG quality; `normalizeImage` encodes the final one at 0.85. */
const RASTER_QUALITY = 0.92;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas could not encode JPEG"));
      },
      "image/jpeg",
      RASTER_QUALITY,
    );
  });
}

/**
 * Renders the first pages of a PDF (at most `maxPages` and `PDF_MAX_PAGES`) as JPEG blobs whose
 * long edge is `PROCESSED_LONG_EDGE`. `trimmed` says that the file had more pages. Rejects for a
 * PDF that is unreadable or password-protected.
 */
export async function rasterizePdf(
  file: Blob,
  options: { maxPages: number; signal: AbortSignal },
): Promise<{ pages: Blob[]; trimmed: boolean }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const onAbort = (): void => {
    void task.destroy();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const doc = await task.promise;
    const count = Math.min(doc.numPages, options.maxPages, PDF_MAX_PAGES);
    const pages: Blob[] = [];
    for (let number = 1; number <= count; number += 1) {
      if (options.signal.aborted) throw new DOMException("aborted", "AbortError");
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = PROCESSED_LONG_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      pages.push(await canvasToJpeg(canvas));
      page.cleanup();
    }
    return { pages, trimmed: doc.numPages > count };
  } finally {
    options.signal.removeEventListener("abort", onAbort);
    void task.destroy();
  }
}

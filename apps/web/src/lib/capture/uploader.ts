import { t } from "@wasfa/shared/i18n";
import { CaptureError, type CaptureUploader, type PreparedImage } from "@wasfa/ui";

import { convertHeicToJpeg, isHeicFile } from "./heic";
import { normalizeImage } from "./normalize-image";
import { isPdfFile, rasterizePdf } from "./pdf";
import { userTransport } from "./transports";
import { createUploadQueue, isAbortError, type UploadTransport } from "./upload-queue";

async function prepareHeic(file: File, signal: AbortSignal): Promise<PreparedImage> {
  try {
    // Safari (and any browser that learns to) decodes HEIC itself: no converter download.
    return await normalizeImage(file, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    // Anything else falls through to the converter.
  }
  let converted: Blob;
  try {
    converted = await convertHeicToJpeg(file);
  } catch {
    throw new CaptureError(t("capture.error.heic"));
  }
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return normalizeImage(converted, signal);
}

async function preparePdf(
  file: File,
  options: { signal: AbortSignal; maxPages: number },
): Promise<{ pages: PreparedImage[]; trimmed: boolean }> {
  let raster: { pages: Blob[]; trimmed: boolean };
  try {
    raster = await rasterizePdf(file, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new CaptureError(t("capture.error.pdf"));
  }
  const pages: PreparedImage[] = [];
  for (const blob of raster.pages) pages.push(await normalizeImage(blob, options.signal));
  return { pages, trimmed: raster.trimmed };
}

/** Picked file to ready pages: HEIC converted, a PDF split, then resized, encoded and checked. */
export const prepareFile: CaptureUploader["prepare"] = async (file, options) => {
  if (isPdfFile(file)) return preparePdf(file, options);
  if (isHeicFile(file)) return { pages: [await prepareHeic(file, options.signal)], trimmed: false };
  return { pages: [await normalizeImage(file, options.signal)], trimmed: false };
};

/** The uploader `CaptureSurface` needs, on top of a transport (default: the signed-in person's). */
export function createCaptureUploader(transport: UploadTransport = userTransport): CaptureUploader {
  const queue = createUploadQueue(transport);
  return { prepare: prepareFile, upload: (image, options) => queue.upload(image, options) };
}

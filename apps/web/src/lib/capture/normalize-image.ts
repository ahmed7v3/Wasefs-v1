import { t } from "@wasfa/shared/i18n";
import { CaptureError, type PreparedImage } from "@wasfa/ui";

import { ImageDecodeError, normalizeBlob } from "./normalize-core";

import type { NormalizeReply } from "./normalize.worker";

/** A file this large is not a photo of a prescription; refuse before decoding it. */
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** True when the browser can run the pipeline in a Worker (it needs OffscreenCanvas there). */
function canUseWorker(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/**
 * Runs the pipeline in a Worker. Resolves `undefined` when the Worker cannot be used (blocked,
 * failed to load, no 2d context in it), so the caller falls back to the main thread.
 */
function inWorker(source: Blob, signal: AbortSignal): Promise<PreparedImage | undefined> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./normalize.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(undefined);
      return;
    }
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      finish();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<NormalizeReply>) => {
      finish();
      const reply = event.data;
      if (reply.ok) resolve(reply.image);
      else if (reply.reason === "decode") reject(new CaptureError(t("capture.error.decode")));
      else resolve(undefined);
    });
    worker.addEventListener("error", () => {
      finish();
      resolve(undefined);
    });
    worker.postMessage(source);
  });
}

/**
 * Turns a picked image (JPEG, PNG, WebP, a HEIC this browser can decode) into the page that is
 * uploaded: upright, at most 2048 px on the long edge, JPEG q0.85, with its SHA-256 and quality
 * issues. Throws `CaptureError` (unreadable picture) or an `AbortError`.
 */
export async function normalizeImage(source: Blob, signal: AbortSignal): Promise<PreparedImage> {
  if (signal.aborted) throw abortError();
  if (source.size > MAX_INPUT_BYTES) throw new CaptureError(t("capture.tooLarge"));

  if (canUseWorker()) {
    const fromWorker = await inWorker(source, signal);
    if (fromWorker) return fromWorker;
  }
  try {
    const image = await normalizeBlob(source);
    if (signal.aborted) throw abortError();
    return image;
  } catch (error) {
    if (error instanceof ImageDecodeError) throw new CaptureError(t("capture.error.decode"));
    throw error;
  }
}

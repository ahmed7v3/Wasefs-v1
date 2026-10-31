import type { RawMessage } from "./inbound.js";

/*
 * One media download with a deadline per attempt, two retries and, when WhatsApp says the file is
 * gone from its servers (404 / 410 / expired url), one re-upload request to the sender's phone
 * (docs/WA-AGENT-RUNTIME.md §4.2). Only the outcome is returned; nothing here logs, and no url or
 * phone ever appears in an error.
 */

export const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;
/** Pauses before retry 1 and retry 2. */
export const MEDIA_RETRY_DELAYS_MS = [1_000, 4_000] as const;

export interface DownloadIo {
  /** Decrypted bytes of the message's media; `signal` aborts the attempt. */
  download: (raw: RawMessage, signal?: AbortSignal) => Promise<Buffer>;
  /** Asks the sender's phone to upload the media again; returns the message with its new url. */
  reupload?: (raw: RawMessage) => Promise<RawMessage>;
}

export type DownloadOutcome =
  { ok: true; body: Buffer } | { ok: false; reason: "download_failed" | "expired" };

/** A 404 / 410 / "expired" style failure: the url no longer serves the file. */
export function isGone(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, statusCode, output, message } = error as {
    status?: unknown;
    statusCode?: unknown;
    output?: { statusCode?: unknown };
    message?: unknown;
  };
  const code = [status, statusCode, output?.statusCode].find((value) => typeof value === "number");
  if (code === 404 || code === 410) return true;
  return typeof message === "string" && /\b(404|410)\b|expired|gone/i.test(message);
}

function attemptOnce(io: DownloadIo, raw: RawMessage): Promise<Buffer> {
  // A plain controller + timer rather than AbortSignal.timeout, so fake timers drive it in tests.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, MEDIA_DOWNLOAD_TIMEOUT_MS);
  // Baileys' download may not honour the signal: race it, and drop whatever it returns late.
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(new Error("media download timed out"));
    });
  });
  return Promise.race([io.download(raw, controller.signal), aborted]).finally(() => {
    clearTimeout(timer);
  });
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function downloadWithRetries(
  io: DownloadIo,
  raw: RawMessage,
): Promise<DownloadOutcome> {
  let current = raw;
  let reuploaded = false;
  let expired = false;
  for (let attempt = 0; attempt <= MEDIA_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return { ok: true, body: await attemptOnce(io, current) };
    } catch (error) {
      if (isGone(error)) {
        if (!reuploaded && io.reupload) {
          reuploaded = true;
          try {
            current = await io.reupload(current);
            expired = false;
            // The fresh url is tried at once, without spending a pause.
            attempt -= 1;
            continue;
          } catch {
            expired = true;
          }
        } else {
          expired = true;
        }
      }
    }
    const delay = MEDIA_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await pause(delay);
  }
  return { ok: false, reason: expired ? "expired" : "download_failed" };
}

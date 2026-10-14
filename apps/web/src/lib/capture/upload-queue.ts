import { t } from "@wasfa/shared/i18n";
import {
  UPLOAD_REJECT_REASONS,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type FileStatusResponse,
  type UploadRejectReason,
} from "@wasfa/shared/schemas/files";
import { CaptureError, type PreparedImage } from "@wasfa/ui";

import { ApiRequestError, extractErrorRef } from "../api-error";

/*
 * The upload pipeline of one prescription page (Task 2.6): ask for a presigned PUT, PUT the bytes
 * straight to storage with progress, tell the API it is done, then wait until the worker has
 * processed the picture. At most `concurrency` pages are in flight at once; a failing step is
 * retried with exponential backoff (1, 2, 4 s) when the failure is the network or a 5xx; the whole
 * thing is cancelled by the caller's `AbortSignal`. It knows nothing about routes: a `transport`
 * supplies them, so the signed-in desktop and the phone (token) share it.
 */

export interface UploadTransport {
  create(
    input: { mime: string; bytes: number; sha256: string; width: number; height: number },
    signal: AbortSignal,
  ): Promise<CreateUploadResponse>;
  put(
    target: { url: string; headers: Record<string, string> },
    body: Blob,
    handlers: { signal: AbortSignal; onProgress: (fraction: number) => void },
  ): Promise<void>;
  complete(fileId: string, signal: AbortSignal): Promise<CompleteUploadResponse>;
  /** Absent where there is no session to ask with (the phone): the page is done after `complete`. */
  status?(fileId: string, signal: AbortSignal): Promise<FileStatusResponse>;
}

export interface UploadQueueOptions {
  /** Pages uploaded at once. Default 2. */
  concurrency?: number;
  /** Waits before retry 1, 2, 3. Default 1, 2, 4 seconds. */
  backoffMs?: readonly number[];
  /** Time between status checks, and how long to wait for the worker in total. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Replaceable in tests. Rejects with an `AbortError` when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The connection failed or storage answered 5xx: worth trying again. */
export class UploadNetworkError extends Error {
  constructor(message = "network error during upload") {
    super(message);
    this.name = "UploadNetworkError";
  }
}

/** Storage said no (for example an expired signature): trying again will not help. */
export class UploadRefusedError extends Error {
  constructor(readonly status: number) {
    super(`storage refused the upload (${String(status)})`);
    this.name = "UploadRefusedError";
  }
}

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof UploadNetworkError) return true;
  if (error instanceof ApiRequestError) {
    return error.status >= 500 || error.code === "UPSTREAM_UNAVAILABLE";
  }
  return false;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** While the device is offline there is no point in burning a retry: wait for the connection. */
function waitForOnline(signal: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.removeEventListener("online", onOnline);
      signal.removeEventListener("abort", onAbort);
    };
    const onOnline = (): void => {
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    window.addEventListener("online", onOnline, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** What the person is told. `ref` is the support reference when the API gave one. */
export function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  if (error instanceof ApiRequestError) {
    return new CaptureError(error.message, extractErrorRef(error));
  }
  return new CaptureError(t("capture.error.generic"));
}

function isRejectReason(value: string | null): value is UploadRejectReason {
  return (UPLOAD_REJECT_REASONS as readonly (string | null)[]).includes(value);
}

export function rejectionMessage(reason: string | null): string {
  return isRejectReason(reason) ? t(`capture.error.reason.${reason}`) : t("capture.error.generic");
}

/** A counting gate: at most `limit` holders; waiting is abortable. */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw abortError();
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          const at = this.waiting.indexOf(turn);
          if (at !== -1) this.waiting.splice(at, 1);
          reject(abortError());
        };
        const turn = (): void => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        this.waiting.push(turn);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000] as const;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_TIMEOUT_MS = 90_000;

type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

/** Runs one step; a network failure or 5xx is retried after each delay of `backoffMs`. */
async function withRetry<T>(
  signal: AbortSignal,
  backoffMs: readonly number[],
  wait: Wait,
  run: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await waitForOnline(signal);
    try {
      return await run();
    } catch (error) {
      const delay = backoffMs[attempt];
      if (signal.aborted) throw abortError();
      if (delay === undefined || !isRetryable(error)) throw error;
      await wait(delay, signal);
    }
  }
}

/**
 * Waits until a file is processed. A rejected file throws a `CaptureError` with its reason. Used
 * after `complete`, and for pages that arrive from a phone (the desktop did not upload those).
 */
export async function waitUntilProcessed(
  check: (fileId: string, signal: AbortSignal) => Promise<FileStatusResponse>,
  fileId: string,
  signal: AbortSignal,
  options: UploadQueueOptions = {},
): Promise<void> {
  const {
    backoffMs = DEFAULT_BACKOFF_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    sleep: wait = sleep,
  } = options;
  const deadline = Date.now() + pollTimeoutMs;
  try {
    for (;;) {
      const current = await withRetry(signal, backoffMs, wait, () => check(fileId, signal));
      if (current.status === "processed") return;
      if (current.status === "rejected") {
        throw new CaptureError(rejectionMessage(current.rejectReason));
      }
      if (current.status === "deleted" || Date.now() >= deadline) {
        throw new CaptureError(t("capture.error.generic"));
      }
      await wait(pollIntervalMs, signal);
    }
  } catch (error) {
    throw isAbortError(error) ? error : toCaptureError(error);
  }
}

export interface UploadQueue {
  upload(
    image: PreparedImage,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void },
  ): Promise<{ fileId: string }>;
}

export function createUploadQueue(
  transport: UploadTransport,
  options: UploadQueueOptions = {},
): UploadQueue {
  const { concurrency = 2, backoffMs = DEFAULT_BACKOFF_MS, sleep: wait = sleep } = options;
  const gate = new Gate(concurrency);

  return {
    async upload(image, { signal, onProgress }) {
      const release = await gate.acquire(signal);
      let fileId: string;
      let done: CompleteUploadResponse;
      try {
        const created = await withRetry(signal, backoffMs, wait, () =>
          transport.create(
            {
              mime: "image/jpeg",
              bytes: image.blob.size,
              sha256: image.sha256,
              width: image.width,
              height: image.height,
            },
            signal,
          ),
        );
        fileId = created.fileId;
        await withRetry(signal, backoffMs, wait, () => {
          onProgress(0);
          return transport.put(created, image.blob, { signal, onProgress });
        });
        done = await withRetry(signal, backoffMs, wait, () =>
          transport.complete(created.fileId, signal),
        );
      } catch (error) {
        throw isAbortError(error) ? error : toCaptureError(error);
      } finally {
        // Free the slot before waiting for the server: the next page can start uploading.
        release();
      }
      const check = transport.status;
      if (done.status !== "processed" && check) {
        await waitUntilProcessed(
          (id, abort) => check.call(transport, id, abort),
          fileId,
          signal,
          options,
        );
      }
      onProgress(1);
      return { fileId };
    },
  };
}

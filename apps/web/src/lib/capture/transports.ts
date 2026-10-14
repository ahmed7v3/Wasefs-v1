import {
  completeUploadResponseSchema,
  createUploadResponseSchema,
  fileStatusResponseSchema,
} from "@wasfa/shared/schemas/files";

import { api } from "../api-client";

import { UploadNetworkError, UploadRefusedError, type UploadTransport } from "./upload-queue";

import type { FilePurpose } from "@wasfa/shared/ai";

/** PUT to the presigned URL with real progress (`fetch` has none for uploads). */
export function xhrPut(
  target: { url: string; headers: Record<string, string> },
  body: Blob,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const onAbort = (): void => {
      request.abort();
    };
    const done = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    request.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      done();
      if (request.status >= 200 && request.status < 300) resolve();
      else if (request.status >= 500) reject(new UploadNetworkError());
      else reject(new UploadRefusedError(request.status));
    };
    request.onerror = () => {
      done();
      reject(new UploadNetworkError());
    };
    request.ontimeout = request.onerror;
    request.onabort = () => {
      done();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.send(body);
  });
}

/**
 * The signed-in person's uploads: `/uploads`, `/uploads/:id/complete`, `/files/:id`. The purpose
 * says what the file is for (a prescription page, or a picture attached to a chat message).
 */
export function userTransportFor(purpose: FilePurpose): UploadTransport {
  return {
    create: (input, signal) =>
      api("/uploads", {
        method: "POST",
        body: { purpose, ...input },
        schema: createUploadResponseSchema,
        signal,
      }),
    put: xhrPut,
    complete: (fileId, signal) =>
      api(`/uploads/${fileId}/complete`, {
        method: "POST",
        schema: completeUploadResponseSchema,
        signal,
      }),
    status: (fileId, signal) =>
      api(`/files/${fileId}`, { schema: fileStatusResponseSchema, signal }),
  };
}

/** Prescription pages: the default of every capture screen. */
export const userTransport: UploadTransport = userTransportFor("rx_page");

/**
 * A phone with a handoff token: it can only create and complete pages for the desktop session,
 * and has no session to ask about processing, so there is no `status`.
 */
export function handoffTransport(token: string): UploadTransport {
  return {
    create: (input, signal) =>
      api(`/handoff/${token}/uploads`, {
        method: "POST",
        body: { purpose: "rx_page", ...input },
        schema: createUploadResponseSchema,
        signal,
      }),
    put: xhrPut,
    complete: (fileId, signal) =>
      api(`/handoff/${token}/uploads/${fileId}/complete`, {
        method: "POST",
        schema: completeUploadResponseSchema,
        signal,
      }),
  };
}

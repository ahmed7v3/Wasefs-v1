import {
  completeUploadResponseSchema,
  createUploadResponseSchema,
  fileStatusResponseSchema,
  UPLOAD_MAX_BYTES,
} from "@wasfa/shared/schemas/files";

import { api } from "./api-client";
import { ApiRequestError } from "./api-error";

/*
 * Attaches a picture to a chat message through the same flow as every upload (presigned PUT to
 * R2, `complete`, wait for the worker). Minimal on purpose: no cropping or HEIC conversion here.
 * TODO(2.11): swap for the shared CaptureSurface once the chat composer hosts it.
 */

const CHAT_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const POLL_MS = 600;
const POLL_TIMEOUT_MS = 30_000;

export type ChatUploadFailure = "unsupported" | "too_large" | "failed" | "rejected";

export class ChatUploadError extends Error {
  constructor(readonly reason: ChatUploadFailure) {
    super(reason);
    this.name = "ChatUploadError";
  }
}

export function isChatImage(file: File): boolean {
  return (CHAT_MIMES as readonly string[]).includes(file.type);
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Uploads one picture and resolves with its file id once it can be sent with a message. */
export async function uploadChatImage(file: File, signal: AbortSignal): Promise<string> {
  if (!isChatImage(file)) throw new ChatUploadError("unsupported");
  if (file.size > UPLOAD_MAX_BYTES) throw new ChatUploadError("too_large");
  try {
    const bytes = await file.arrayBuffer();
    const upload = await api("/uploads", {
      method: "POST",
      body: {
        purpose: "chat_image",
        mime: file.type,
        bytes: file.size,
        sha256: await sha256Hex(bytes),
      },
      schema: createUploadResponseSchema,
      signal,
    });
    const put = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: bytes,
      signal,
    });
    if (!put.ok) throw new ChatUploadError("failed");
    const done = await api(`/uploads/${upload.fileId}/complete`, {
      method: "POST",
      schema: completeUploadResponseSchema,
      signal,
    });
    if (done.status === "processed") return done.fileId;

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await wait(POLL_MS, signal);
      const status = await api(`/files/${upload.fileId}`, {
        schema: fileStatusResponseSchema,
        signal,
      });
      if (status.status === "processed") return status.fileId;
      if (status.status === "rejected" || status.status === "deleted") {
        throw new ChatUploadError("rejected");
      }
    }
    throw new ChatUploadError("failed");
  } catch (error) {
    if (error instanceof ChatUploadError) throw error;
    if (signal.aborted) throw error;
    if (error instanceof ApiRequestError && error.details?.["reason"] !== undefined) {
      throw new ChatUploadError("rejected");
    }
    throw new ChatUploadError("failed");
  }
}

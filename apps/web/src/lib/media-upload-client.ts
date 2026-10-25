import {
  MEDIA_MAX_BYTES,
  MEDIA_MIMES,
  mediaAssetSchema,
  mediaUploadResponseSchema,
  type MediaAsset,
} from "@wasfa/shared/schemas/media";

import { api } from "./api-client";
import { ApiRequestError } from "./api-error";

/*
 * The media library's upload client (CONTENT-PLATFORM §5.2), with a per-file state machine the upload
 * panel renders: hash the file, ask the API for a presigned PUT bound to that hash, PUT the bytes
 * straight to the media bucket, commit, then poll the asset until the worker has made it `ready` or
 * `rejected`. The API never sees the bytes. (`media-upload.ts` wraps this in a promise for the editor's
 * pasted images; this one reports every phase for the library, the picker and the person form.)
 */

export const POLL_INTERVAL_MS = 1_500;
export const POLL_TIMEOUT_MS = 90_000;

export type PrecheckProblem = "empty" | "unsupported_type" | "too_large";

/** Cheap checks before any request; the worker re-validates the real bytes. `null` = acceptable. */
export function precheckFile(file: { type: string; size: number }): PrecheckProblem | null {
  if (file.size <= 0) return "empty";
  if (!(MEDIA_MIMES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > MEDIA_MAX_BYTES) return "too_large";
  return null;
}

/** Lower-case hex SHA-256 of a blob, computed with Web Crypto in the browser. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type PollOutcome =
  { kind: "settled"; asset: MediaAsset } | { kind: "timeout"; asset: MediaAsset };

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Injected so tests drive time with fake timers. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal | undefined;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Polls `load` until the asset leaves `staged`/`processing` (it is then `ready` or `rejected`) or the
 * time runs out; a transient read failure is retried rather than ended, a 404 is final.
 */
export async function pollAsset(
  first: MediaAsset,
  load: () => Promise<MediaAsset>,
  {
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    sleep = defaultSleep,
    signal,
  }: PollOptions = {},
): Promise<PollOutcome> {
  let asset = first;
  let waited = 0;
  while (asset.status === "staged" || asset.status === "processing") {
    if (waited >= timeoutMs || signal?.aborted) return { kind: "timeout", asset };
    await sleep(intervalMs);
    waited += intervalMs;
    try {
      asset = await load();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "NOT_FOUND") throw error;
      // Any other failure is treated as transient: try again until the deadline.
    }
  }
  return { kind: "settled", asset };
}

export type UploadPhase =
  | "hashing"
  | "creating"
  | "uploading"
  | "committing"
  | "processing"
  | "ready"
  | "rejected"
  | "failed"
  | "timeout";

export interface UploadState {
  phase: UploadPhase;
  asset?: MediaAsset | undefined;
  /** `precheck:<problem>` or the error thrown by the failing step. */
  error?: unknown;
}

export interface UploadDeps {
  fetchImpl?: typeof fetch;
  onPhase: (state: UploadState) => void;
  poll?: PollOptions;
}

/**
 * Runs the whole flow for one file and reports each phase. Never throws: a failure ends in a
 * `failed` state carrying the error. An image already `ready` under the same hash (dedupe) skips the PUT.
 */
export async function uploadMediaFile(file: File, deps: UploadDeps): Promise<UploadState> {
  const { onPhase, fetchImpl = fetch } = deps;
  const report = (state: UploadState): UploadState => {
    onPhase(state);
    return state;
  };

  const problem = precheckFile(file);
  if (problem) return report({ phase: "failed", error: `precheck:${problem}` });

  try {
    report({ phase: "hashing" });
    const sha256 = await sha256Hex(file);

    report({ phase: "creating" });
    const created = await api("/admin/media/uploads", {
      method: "POST",
      body: { mime: file.type, bytes: file.size, sha256 },
      schema: mediaUploadResponseSchema,
    });
    let asset = created.asset;

    if (created.upload) {
      report({ phase: "uploading", asset });
      const response = await fetchImpl(created.upload.url, {
        method: "PUT",
        headers: created.upload.headers,
        body: file,
      });
      if (!response.ok) {
        return report({
          phase: "failed",
          asset,
          error: new Error(`upload ${String(response.status)}`),
        });
      }
      report({ phase: "committing", asset });
      asset = await api(`/admin/media/${asset.id}/commit`, {
        method: "POST",
        schema: mediaAssetSchema,
      });
    }

    report({ phase: "processing", asset });
    const settledId = asset.id;
    const outcome = await pollAsset(
      asset,
      () => api(`/admin/media/${settledId}`, { schema: mediaAssetSchema }),
      deps.poll,
    );
    if (outcome.kind === "timeout") return report({ phase: "timeout", asset: outcome.asset });
    return report({
      phase: outcome.asset.status === "ready" ? "ready" : "rejected",
      asset: outcome.asset,
    });
  } catch (error) {
    return report({ phase: "failed", error });
  }
}

/** The markdown snippet that places the asset in an article body. */
export function mediaSnippet(asset: Pick<MediaAsset, "id" | "altAr">): string {
  const alt = (asset.altAr ?? "").replaceAll("[", "(").replaceAll("]", ")").trim();
  return `![${alt}](media:${asset.id})`;
}

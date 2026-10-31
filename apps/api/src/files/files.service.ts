import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import {
  FILE_URL_TTL_SECONDS,
  PROCESSED_MIME,
  UPLOAD_MAX_BYTES,
  UPLOAD_RATE_LIMIT,
  UPLOAD_URL_TTL_SECONDS,
  isHeicMime,
  type CompleteUploadResponse,
  type CreateUploadInput,
  type CreateUploadResponse,
  type FileStatusResponse,
  type FileUrlResponse,
  type ImportMime,
  type UploadRejectReason,
} from "@wasfa/shared/schemas/files";
import { isPdfObjectKey, originalObjectKey } from "@wasfa/shared/storage";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { SettingsService } from "../settings/settings.service.js";

import { FilesRepo } from "./files.repo.js";
import { ImageQueue } from "./image-queue.js";
import { ObjectStorage } from "./object-storage.js";

import type { FileViewer } from "./files.repo.js";
import type { FileRecord } from "@wasfa/db";
import type { FileMime } from "@wasfa/shared/ai";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a server-side import may create: the two kinds of file the WhatsApp agent forwards. */
export type ImportPurpose = "rx_page" | "payment_proof";

/** A refusal the web app can explain: `details.reason` is one of `UPLOAD_REJECT_REASONS`. */
function refusal(reason: UploadRejectReason): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, {
    httpStatus: 422,
    details: { reason },
  });
}

/**
 * Uploads (Task 2.5). The browser PUTs straight to R2 with a URL signed for the exact size, type and
 * SHA-256 it declared, then calls `complete`; the api checks what actually landed in the bucket and
 * hands the file to the worker. Files belong to the caller's own account for now; the owner columns
 * and the viewer rules already cover organizations.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly repo: FilesRepo,
    private readonly storage: ObjectStorage,
    private readonly images: ImageQueue,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  async createUpload(user: FileViewer, input: CreateUploadInput): Promise<CreateUploadResponse> {
    // Counted before anything else, so refused attempts cost the caller too.
    const proofUpload = input.purpose === "payment_proof";
    await this.limiter.hit(
      proofUpload ? `payment-proof-presign:user:${user.id}` : `uploads:user:${user.id}`,
      proofUpload ? 10 : UPLOAD_RATE_LIMIT.max,
      proofUpload ? 3_600 : UPLOAD_RATE_LIMIT.windowSeconds,
    );
    if (isHeicMime(input.mime)) throw refusal("heic_unsupported");
    if (!this.storage.configured) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "storage_not_configured" },
      });
    }

    const { retentionDays } = await this.settings.get("uploads");
    const proofRetentionDays = proofUpload
      ? (await this.settings.get("billing")).proofRetentionDays
      : retentionDays;
    const fileId = newId();
    const isPdf = input.mime === "application/pdf";
    const key = originalObjectKey(user.id, fileId, isPdf);
    // Presign first: if storage is down, no row is left behind.
    const put = await this.storage.presignPut({
      key,
      contentType: input.mime,
      bytes: input.bytes,
      sha256Hex: input.sha256,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
    await this.repo.insert({
      id: fileId,
      ownerUserId: user.id,
      createdBy: user.id,
      purpose: input.purpose,
      r2Key: key,
      // A PDF becomes a JPEG; `files.mime` only holds image types. The key says it was a PDF.
      mime: isPdf ? PROCESSED_MIME : (input.mime as FileMime),
      bytes: input.bytes,
      width: input.width ?? null,
      height: input.height ?? null,
      expiresAt: new Date(Date.now() + proofRetentionDays * DAY_MS),
    });
    return {
      fileId,
      url: put.url,
      headers: put.headers,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * Takes a file the api already holds in the uploads bucket (a WhatsApp attachment) in as the
   * viewer's own file: a server-side copy to the usual `u/<owner>/<id>/original` key, a `files` row
   * for `purpose`, and the same hand-over to the worker as a finished browser upload. The copy is
   * checked for size; the bytes are never read here. Returns the new file id.
   */
  async importObject(
    user: FileViewer,
    input: { sourceKey: string; purpose: ImportPurpose; mime: ImportMime; bytes: number },
  ): Promise<string> {
    if (!this.storage.configured) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "storage_not_configured" },
      });
    }
    if (input.bytes < 1 || input.bytes > UPLOAD_MAX_BYTES) throw refusal("size_mismatch");
    const fileId = newId();
    const isPdf = input.mime === "application/pdf";
    const key = originalObjectKey(user.id, fileId, isPdf);
    if (!(await this.storage.copy(input.sourceKey, key, input.mime))) {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { reason: "source_missing" } });
    }
    const head = await this.storage.head(key);
    if (head === null || head.bytes < 1 || head.bytes > UPLOAD_MAX_BYTES) {
      await this.storage.remove(key);
      throw refusal("size_mismatch");
    }
    const retentionDays =
      input.purpose === "payment_proof"
        ? (await this.settings.get("billing")).proofRetentionDays
        : (await this.settings.get("uploads")).retentionDays;
    const file = await this.repo.insert({
      id: fileId,
      ownerUserId: user.id,
      createdBy: user.id,
      purpose: input.purpose,
      r2Key: key,
      // The row can only hold a FileMime; a PDF or HEIC original is turned into a JPEG by the worker.
      mime: isPdf || isHeicMime(input.mime) ? PROCESSED_MIME : (input.mime as FileMime),
      bytes: head.bytes,
      expiresAt: new Date(Date.now() + retentionDays * DAY_MS),
    });
    if (await this.repo.markUploaded(file)) await this.images.process(file.id);
    return fileId;
  }

  /**
   * Waits for the worker to finish (or reject) one of the viewer's files. Returns its status; still
   * `uploaded` after `timeoutMs` means the worker is busy, not that the file is bad.
   */
  async awaitProcessed(
    user: FileViewer,
    fileId: string,
    options: { timeoutMs: number; pollMs: number; sleep?: (ms: number) => Promise<void> },
  ): Promise<FileRecord["status"]> {
    const sleep =
      options.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
    let status = (await this.require(user, fileId)).status;
    for (
      let waited = 0;
      status === "uploaded" && waited < options.timeoutMs;
      waited += options.pollMs
    ) {
      await sleep(options.pollMs);
      status = (await this.require(user, fileId)).status;
    }
    return status;
  }

  /**
   * Checks the stored object against what was declared. A mismatch deletes the object and rejects
   * the file: whatever the signature allowed, nothing of the wrong size or type is kept.
   */
  async completeUpload(user: FileViewer, fileId: string): Promise<CompleteUploadResponse> {
    const file = await this.require(user, fileId);
    if (file.status === "uploaded" || file.status === "processed") {
      return { fileId, status: file.status };
    }
    if (file.status === "rejected") throw refusal(asReason(file.rejectReason));
    if (file.status !== "pending") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: file.status } });
    }

    const head = await this.storage.head(file.r2Key);
    if (head === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "upload_missing" } });
    }
    const expectedType = isPdfObjectKey(file.r2Key) ? "application/pdf" : file.mime;
    const mismatch: UploadRejectReason | null =
      head.bytes !== file.bytes
        ? "size_mismatch"
        : head.contentType.toLowerCase() !== expectedType
          ? "type_mismatch"
          : null;
    if (mismatch !== null) {
      await this.storage.remove(file.r2Key);
      await this.repo.markRejected(file, mismatch);
      throw refusal(mismatch);
    }

    if (await this.repo.markUploaded(file)) await this.images.process(file.id);
    return { fileId, status: "uploaded" };
  }

  /** Status and, for a rejected file, the reason code. Someone else's file is `NOT_FOUND`. */
  async status(user: FileViewer, fileId: string): Promise<FileStatusResponse> {
    const file = await this.require(user, fileId);
    return {
      fileId,
      status: file.status,
      rejectReason: file.status === "rejected" ? asReason(file.rejectReason) : null,
    };
  }

  /** A 60 second link to the processed image. Only a processed file has one. */
  async viewUrl(user: FileViewer, fileId: string): Promise<FileUrlResponse> {
    const file = await this.require(user, fileId);
    if (file.status !== "processed") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: file.status } });
    }
    return {
      url: await this.storage.presignGet(file.r2Key, FILE_URL_TTL_SECONDS),
      expiresInSeconds: FILE_URL_TTL_SECONDS,
    };
  }

  async adminViewUrl(fileId: string): Promise<FileUrlResponse> {
    const file = await this.repo.findById(fileId);
    if (!file || file.purpose !== "payment_proof") throw new AppError(ErrorCode.NOT_FOUND);
    if (file.status !== "processed")
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: file.status } });
    return {
      url: await this.storage.presignGet(file.r2Key, FILE_URL_TTL_SECONDS),
      expiresInSeconds: FILE_URL_TTL_SECONDS,
    };
  }

  /**
   * A short link to a prescription or chat picture for the admin viewer (after a PHI access
   * session). `null` once the retention job deleted the picture: the row stays, the file is gone.
   */
  async adminPictureUrl(fileId: string): Promise<FileUrlResponse | null> {
    const file = await this.repo.findById(fileId);
    if (!file || file.purpose === "payment_proof") throw new AppError(ErrorCode.NOT_FOUND);
    if (file.status !== "processed") return null;
    return {
      url: await this.storage.presignGet(file.r2Key, FILE_URL_TTL_SECONDS),
      expiresInSeconds: FILE_URL_TTL_SECONDS,
    };
  }

  private async require(user: FileViewer, fileId: string): Promise<FileRecord> {
    const file = await this.repo.findFor(user, fileId);
    if (!file) throw new AppError(ErrorCode.NOT_FOUND);
    return file;
  }
}

function asReason(stored: string | null): UploadRejectReason {
  return (stored ?? "corrupt_image") as UploadRejectReason;
}

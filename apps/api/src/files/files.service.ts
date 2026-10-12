import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import {
  FILE_URL_TTL_SECONDS,
  PROCESSED_MIME,
  UPLOAD_RATE_LIMIT,
  UPLOAD_URL_TTL_SECONDS,
  isHeicMime,
  type CompleteUploadResponse,
  type CreateUploadInput,
  type CreateUploadResponse,
  type FileUrlResponse,
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
    await this.limiter.hit(
      `uploads:user:${user.id}`,
      UPLOAD_RATE_LIMIT.max,
      UPLOAD_RATE_LIMIT.windowSeconds,
    );
    if (isHeicMime(input.mime)) throw refusal("heic_unsupported");
    if (!this.storage.configured) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "storage_not_configured" },
      });
    }

    const { retentionDays } = await this.settings.get("uploads");
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
      expiresAt: new Date(Date.now() + retentionDays * DAY_MS),
    });
    return {
      fileId,
      url: put.url,
      headers: put.headers,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
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

  private async require(user: FileViewer, fileId: string): Promise<FileRecord> {
    const file = await this.repo.findFor(user, fileId);
    if (!file) throw new AppError(ErrorCode.NOT_FOUND);
    return file;
  }
}

function asReason(stored: string | null): UploadRejectReason {
  return (stored ?? "corrupt_image") as UploadRejectReason;
}

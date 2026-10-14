import { PROCESSED_MIME, UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";
import { isPdfObjectKey, processedObjectKey } from "@wasfa/shared/storage";

import { processImage } from "../images/process-image.js";
import { ImageRejected } from "../images/rejected.js";

import { findFile, markProcessed, markRejected } from "./files.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type ImageContext = Pick<JobContext, "db" | "logger" | "storage">;

/**
 * `image.process`: re-encodes one upload (Task 2.5). Idempotent: only a file still `uploaded` is
 * touched, and the processed object is written before the row and before the original is deleted,
 * so a crash at any point is repaired by the retry. A bad file is rejected with a reason code and
 * its original deleted (a `rejected` file keeps no bytes); an infrastructure error is thrown and
 * retried by the queue. Logs ids and codes only.
 */
export async function imageProcessJob(
  { fileId }: JobPayload<"images", "image.process">,
  { db, logger, storage }: ImageContext,
): Promise<void> {
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  const file = await findFile(db, fileId);
  if (file === null || file.status !== "uploaded") {
    logger.info({ fileId, status: file?.status ?? "missing" }, "Image job skipped");
    return;
  }

  const reject = async (reason: string): Promise<void> => {
    await markRejected(db, fileId, reason);
    await storage.remove(file.r2Key);
    logger.info({ fileId, reason }, "Upload rejected");
  };

  const original = await storage.get(file.r2Key, UPLOAD_MAX_BYTES);
  if (original === null) return reject("upload_missing");

  try {
    const declared = isPdfObjectKey(file.r2Key) ? "application/pdf" : file.mime;
    const image = await processImage(original, declared);
    const ownerId = file.ownerUserId ?? file.ownerOrgId;
    if (ownerId === null) throw new Error("A file always has an owner (files_owner_check)");
    const processedKey = processedObjectKey(ownerId, file.id);

    await storage.put(processedKey, image.jpeg, PROCESSED_MIME);
    const updated = await markProcessed(db, fileId, {
      r2Key: processedKey,
      bytes: image.jpeg.byteLength,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      dhash: image.dhash,
    });
    if (updated) await storage.remove(file.r2Key);
    logger.info({ fileId, width: image.width, height: image.height }, "Image processed");
  } catch (error) {
    if (!(error instanceof ImageRejected)) throw error;
    await reject(error.reason);
  }
}

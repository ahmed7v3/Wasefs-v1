import type { UploadRejectReason } from "@wasfa/shared/schemas/files";

/** The upload is not acceptable (as opposed to an infrastructure failure, which is retried). */
export class ImageRejected extends Error {
  constructor(readonly reason: UploadRejectReason) {
    super(`Image rejected: ${reason}`);
    this.name = "ImageRejected";
  }
}

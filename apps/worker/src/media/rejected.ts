import type { MediaRejectReason } from "@wasfa/shared/schemas/media";

/** The media upload is not acceptable (as opposed to an infrastructure failure, which is retried). */
export class MediaRejected extends Error {
  constructor(readonly reason: MediaRejectReason) {
    super(`Media rejected: ${reason}`);
    this.name = "MediaRejected";
  }
}

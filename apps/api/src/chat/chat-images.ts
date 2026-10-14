import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { FilesRepo } from "../files/files.repo.js";
import { ObjectStorage } from "../files/object-storage.js";

export interface ChatImage {
  fileId: string;
  mime: string;
  data: Uint8Array;
}

/** A processed picture is a JPEG of at most 2048 px, a few hundred KB; anything bigger is not ours. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Attached pictures of a chat message. Only the caller's own, already processed `chat_image` files
 * qualify (a foreign or wrong-purpose id looks like a missing file); the bytes come straight from
 * storage and go to the model, nothing is copied.
 */
@Injectable()
export class ChatImages {
  constructor(
    private readonly files: FilesRepo,
    private readonly storage: ObjectStorage,
  ) {}

  /** Checks every file first, so a bad id fails the request before any picture is downloaded. */
  async load(userId: string, fileIds: readonly string[]): Promise<ChatImage[]> {
    const unique = [...new Set(fileIds)];
    const records = [];
    for (const fileId of unique) {
      // A viewer without organizations: personal files only, whoever's organization they sit in.
      const file = await this.files.findFor({ id: userId, orgIds: [] }, fileId);
      if (!file || file.purpose !== "chat_image") throw new AppError(ErrorCode.NOT_FOUND);
      if (file.status !== "processed") {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "file_not_ready" } });
      }
      records.push(file);
    }
    const images: ChatImage[] = [];
    for (const file of records) {
      images.push({
        fileId: file.id,
        mime: file.mime,
        data: await this.storage.getBytes(file.r2Key, MAX_IMAGE_BYTES),
      });
    }
    return images;
  }
}

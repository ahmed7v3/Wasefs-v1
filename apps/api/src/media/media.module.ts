import { Module } from "@nestjs/common";

import { MediaQueue } from "./media-queue.js";
import { MediaStorage } from "./media-storage.js";
import { MediaController } from "./media.controller.js";
import { MediaRepo } from "./media.repo.js";
import { MediaService } from "./media.service.js";

/** Public media library, admin side (Phase 4 WP2): presigned staging uploads, commit, list, alt text and focal point. */
@Module({
  controllers: [MediaController],
  providers: [MediaStorage, MediaQueue, MediaRepo, MediaService],
  exports: [MediaService],
})
export class MediaModule {}

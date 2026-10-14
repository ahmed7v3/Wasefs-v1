import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { FilesController } from "./files.controller.js";
import { FilesRepo } from "./files.repo.js";
import { FilesService } from "./files.service.js";
import { HandoffController } from "./handoff.controller.js";
import { HandoffHub } from "./handoff.hub.js";
import { HandoffService } from "./handoff.service.js";
import { HandoffStore } from "./handoff.store.js";
import { ImageQueue } from "./image-queue.js";
import { ObjectStorage } from "./object-storage.js";

/** Presigned uploads, the completion check and image links (Task 2.5); phone handoff (Task 2.6). */
@Module({
  imports: [AuthModule],
  controllers: [FilesController, HandoffController],
  providers: [
    ObjectStorage,
    ImageQueue,
    FilesRepo,
    FilesService,
    HandoffStore,
    HandoffHub,
    HandoffService,
  ],
  exports: [FilesService, FilesRepo, ObjectStorage],
})
export class FilesModule {}

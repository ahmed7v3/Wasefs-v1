import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { FilesController } from "./files.controller.js";
import { FilesRepo } from "./files.repo.js";
import { FilesService } from "./files.service.js";
import { ImageQueue } from "./image-queue.js";
import { ObjectStorage } from "./object-storage.js";

/** Presigned uploads, the completion check and image links (Task 2.5). */
@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [ObjectStorage, ImageQueue, FilesRepo, FilesService],
  exports: [FilesService, FilesRepo, ObjectStorage],
})
export class FilesModule {}

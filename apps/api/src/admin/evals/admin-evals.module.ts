import { Module } from "@nestjs/common";

import { FilesModule } from "../../files/files.module.js";

import { AdminEvalsController } from "./admin-evals.controller.js";
import { AdminEvalsRepo } from "./admin-evals.repo.js";
import { AdminEvalsService } from "./admin-evals.service.js";
import { EvalsQueue } from "./evals-queue.js";

/** Accuracy evaluation under `/admin/ai/evals` (Task 2.10). */
@Module({
  imports: [FilesModule],
  controllers: [AdminEvalsController],
  providers: [AdminEvalsRepo, AdminEvalsService, EvalsQueue],
})
export class AdminEvalsModule {}

import { Module } from "@nestjs/common";

import { FlagsController } from "./flags.controller.js";
import { FlagsRepo } from "./flags.repo.js";
import { FlagsService } from "./flags.service.js";

/** Feature flags (Task 1.8). The admin routes that write them arrive with Task 1.10. */
@Module({
  controllers: [FlagsController],
  providers: [FlagsRepo, FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}

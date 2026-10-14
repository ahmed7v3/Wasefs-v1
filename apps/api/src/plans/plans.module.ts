import { Module } from "@nestjs/common";

import { PlansRepo } from "./plans.repo.js";
import { PlansService } from "./plans.service.js";

/** Which plan an owner is on and what it allows (Task 2.2). The plan editor is `AdminPlansModule`. */
@Module({
  providers: [PlansRepo, PlansService],
  exports: [PlansService],
})
export class PlansModule {}

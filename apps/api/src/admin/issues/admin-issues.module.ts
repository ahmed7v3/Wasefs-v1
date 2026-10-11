import { Module } from "@nestjs/common";

import { AdminIssuesController } from "./admin-issues.controller.js";
import { AdminIssuesRepo } from "./admin-issues.repo.js";
import { AdminIssuesService } from "./admin-issues.service.js";

/** `error_events` grouped by fingerprint, with status changes (Task 1.10). */
@Module({
  controllers: [AdminIssuesController],
  providers: [AdminIssuesRepo, AdminIssuesService],
})
export class AdminIssuesModule {}

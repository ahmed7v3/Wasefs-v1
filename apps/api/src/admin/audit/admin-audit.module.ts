import { Module } from "@nestjs/common";

import { AdminAuditController } from "./admin-audit.controller.js";
import { AdminAuditRepo } from "./admin-audit.repo.js";
import { AdminAuditService } from "./admin-audit.service.js";

/** `GET /admin/audit` (Task 1.10). Exported so the user detail can show recent activity. */
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditRepo, AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}

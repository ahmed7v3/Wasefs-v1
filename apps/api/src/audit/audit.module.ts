import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { AuditInterceptor } from "./audit.interceptor.js";
import { AuditRepo } from "./audit.repo.js";
import { AuditService } from "./audit.service.js";

@Global()
@Module({
  providers: [AuditRepo, AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}

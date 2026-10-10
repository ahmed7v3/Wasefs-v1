import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuthModule } from "../auth/auth.module.js";
import { RbacModule } from "../rbac/rbac.module.js";

import { AccessGuard } from "./access.guard.js";
import { AuthGuard } from "./auth.guard.js";
import { FreshAuthGuard } from "./fresh-auth.js";
import { MaintenanceGuard } from "./maintenance.guard.js";
import { OnboardingStatusRepo } from "./onboarding-status.repo.js";
import { OriginGuard } from "./origin.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { VerifiedGuard } from "./verified.guard.js";

/** Deny-by-default access control for the whole API (Task 1.6). */
@Module({
  imports: [AuthModule, RbacModule],
  providers: [
    OriginGuard,
    AuthGuard,
    MaintenanceGuard,
    PermissionsGuard,
    FreshAuthGuard,
    OnboardingStatusRepo,
    VerifiedGuard,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AccessModule {}

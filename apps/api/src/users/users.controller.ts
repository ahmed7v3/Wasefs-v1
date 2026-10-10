import { Body, Controller, Delete, Get, HttpCode, Param, Patch } from "@nestjs/common";

import { Audited, AuditCtx, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequireFreshAuth } from "../common/fresh-auth.js";
import { AllowDuringMaintenance } from "../common/maintenance.guard.js";
import { RateLimit } from "../common/rate-limit.js";

import { IdParamDto, UpdateMeDto } from "./users.schemas.js";
import { UsersService } from "./users.service.js";

/** The caller's own account (Task 1.7). The global `AuthGuard` has already resolved the caller. */
@Controller("me")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // The web app asks who is signed in while it draws the maintenance page.
  @Get()
  @AllowDuringMaintenance()
  @RateLimit(120)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.me(user);
  }

  @Patch()
  @RateLimit(20)
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateMeDto) {
    return this.users.update(user, body);
  }

  @Get("sessions")
  @RateLimit(30)
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.users.sessions(user);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @RateLimit(20)
  @Audited({ action: "session.revoke", targetType: "session" })
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param() params: IdParamDto) {
    await this.users.revokeSession(user, params.id);
  }

  @Delete("sessions")
  @RateLimit(10)
  @Audited({ action: "session.revoke_all", targetType: "user", afterFromResponse: true })
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser, @AuditCtx() audit: AuditScope) {
    audit.targetId = user.id;
    return this.users.revokeOtherSessions(user);
  }

  /** Account deletion request: a stale session must re-enter its password first. */
  @Delete()
  @RequireFreshAuth(5)
  @RateLimit(3, "1 hour")
  @Audited({ action: "user.delete_request", targetType: "user" })
  deleteAccount(@CurrentUser() user: AuthenticatedUser, @AuditCtx() audit: AuditScope) {
    audit.targetId = user.id;
    return this.users.deleteAccount(user);
  }
}

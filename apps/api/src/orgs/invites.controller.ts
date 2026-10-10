import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";

import { InvitesService } from "./invites.service.js";
import { AcceptInviteTokenDto, OrgIdParamDto } from "./orgs.schemas.js";

/** Invitations from the invitee's side: addressed to a verified email or phone of the caller. */
@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get("me/invites")
  @RateLimit(30)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.invites.listMine(user);
  }

  /** The audit target is the organization joined, which only the service knows. */
  @Post("me/invites/:id/accept")
  @HttpCode(200)
  @Audited({ action: "org.invite_accept", targetType: "org" })
  @RateLimit(10)
  acceptById(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdParamDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.invites.accept(user, { id: params.id }, audit);
  }

  @Post("invites/accept")
  @HttpCode(200)
  @Audited({ action: "org.invite_accept", targetType: "org" })
  @RateLimit(10)
  acceptByToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AcceptInviteTokenDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.invites.accept(user, { token: body.token }, audit);
  }
}

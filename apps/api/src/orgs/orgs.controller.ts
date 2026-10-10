import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";

import { InvitesService } from "./invites.service.js";
import {
  OrgIdParamDto,
  OrgInviteParamsDto,
  OrgMemberParamsDto,
  UpdateMemberRoleDto,
  UpdateOrgDto,
  createInviteBodyPipe,
  type CreateInviteBody,
} from "./orgs.schemas.js";
import { OrgsService } from "./orgs.service.js";

import type { FastifyRequest } from "fastify";

/**
 * Organizations, members and invitations. The global `AccessGuard` has authenticated the caller;
 * membership and role are checked by the services against the database, and an organization the
 * caller does not belong to answers `NOT_FOUND`.
 */
@Controller("orgs")
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly invites: InvitesService,
  ) {}

  @Get()
  @RateLimit(60)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orgs.list(user);
  }

  @Get(":id")
  @RateLimit(60)
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdParamDto) {
    return this.orgs.get(user, params.id);
  }

  @Patch(":id")
  @Audited({ action: "org.update", targetType: "org", fields: ["name", "type", "country", "city"] })
  @RateLimit(20)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdParamDto,
    @Body() body: UpdateOrgDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.orgs.update(user, params.id, body, audit);
  }

  @Get(":id/members")
  @RateLimit(60)
  members(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdParamDto) {
    return this.orgs.listMembers(user, params.id);
  }

  @Patch(":id/members/:userId")
  @Audited({
    action: "org.member_role_change",
    targetType: "org_member",
    targetParam: "userId",
    fields: ["role"],
  })
  @RateLimit(20)
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgMemberParamsDto,
    @Body() body: UpdateMemberRoleDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.orgs.changeRole(user, params.id, params.userId, body.role, audit);
  }

  @Delete(":id/members/:userId")
  @HttpCode(204)
  @Audited({ action: "org.member_remove", targetType: "org_member", targetParam: "userId" })
  @RateLimit(20)
  async removeMember(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgMemberParamsDto) {
    await this.orgs.removeMember(user, params.id, params.userId);
  }

  @Post(":id/leave")
  @HttpCode(200)
  @Audited({ action: "org.leave", targetType: "org" })
  @RateLimit(10)
  leave(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdParamDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.orgs.leave(user, params.id, audit, request);
  }

  @Get(":id/invites")
  @RateLimit(60)
  listInvites(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdParamDto) {
    return this.invites.listForOrg(user, params.id);
  }

  @Post(":id/invites")
  @Audited({ action: "org.invite_create", targetType: "org_invite" })
  @RateLimit(10)
  createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdParamDto,
    @Body(createInviteBodyPipe) body: CreateInviteBody,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.invites.create(user, params.id, body, audit);
  }

  @Delete(":id/invites/:inviteId")
  @HttpCode(204)
  @Audited({ action: "org.invite_revoke", targetType: "org_invite", targetParam: "inviteId" })
  @RateLimit(20)
  async revokeInvite(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgInviteParamsDto) {
    await this.invites.revoke(user, params.id, params.inviteId);
  }
}

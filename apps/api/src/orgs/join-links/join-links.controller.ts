import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { createJoinLinkSchema } from "@wasfa/shared/schemas/deals";
import {
  joinSlugParamSchema,
  orgLinkParamsSchema,
  orgMemberParamsSchema,
} from "@wasfa/shared/schemas/org";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { Public } from "../../common/auth.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { JoinLinksService } from "./join-links.service.js";

class OrgIdDto extends createZodDto(idParamSchema) {}
class OrgLinkParamsDto extends createZodDto(orgLinkParamsSchema) {}
class OrgMemberParamsDto extends createZodDto(orgMemberParamsSchema) {}
class CreateJoinLinkDto extends createZodDto(createJoinLinkSchema) {}
class SlugParamDto extends createZodDto(joinSlugParamSchema) {}

/** Join links and join requests of one organization, for its org admins. */
@Controller("orgs")
export class OrgJoinLinksController {
  constructor(private readonly links: JoinLinksService) {}

  @Get(":id/join-links")
  @RateLimit(60)
  list(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdDto) {
    return this.links.listForOrg(user, params.id);
  }

  @Post(":id/join-links")
  @Audited({ action: "org.join_link_create", targetType: "org_join_link" })
  @RateLimit(20)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdDto,
    @Body() body: CreateJoinLinkDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.links.createForOrg(user, params.id, body, audit);
  }

  @Post(":id/join-links/:linkId/disable")
  @HttpCode(200)
  @Audited({
    action: "org.join_link_disable",
    targetType: "org_join_link",
    targetParam: "linkId",
  })
  @RateLimit(20)
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgLinkParamsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.links.disableForOrg(user, params.id, params.linkId, audit);
  }

  @Post(":id/members/:userId/approve")
  @HttpCode(200)
  @Audited({ action: "org.member_approve", targetType: "org_member", targetParam: "userId" })
  @RateLimit(30)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgMemberParamsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.links.approve(user, params.id, params.userId, audit);
  }

  @Post(":id/members/:userId/reject")
  @HttpCode(204)
  @Audited({ action: "org.member_reject", targetType: "org_member", targetParam: "userId" })
  @RateLimit(30)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgMemberParamsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    await this.links.reject(user, params.id, params.userId, audit);
  }
}

/** `/join/<slug>`: the public landing page and the signed-in acceptance. */
@Controller("join")
export class PublicJoinController {
  constructor(private readonly links: JoinLinksService) {}

  /** Public and rate limited per IP; every link that cannot be used answers the same `{ valid: false }`. */
  @Public()
  @Get(":slug")
  @RateLimit(60)
  landing(@Param() params: SlugParamDto) {
    return this.links.landing(params.slug);
  }

  /** The web calls this right after verification, carrying the slug itself (no cookie is involved). */
  @Post(":slug/accept")
  @HttpCode(200)
  @Audited({ action: "org.join_accept", targetType: "org" })
  @RateLimit(10)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SlugParamDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.links.accept(user, params.slug, audit);
  }
}

/** Platform admins manage the join links of any organization (`orgs.read` / `orgs.write`). */
@Controller("admin/orgs")
export class AdminJoinLinksController {
  constructor(private readonly links: JoinLinksService) {}

  @Get(":id/join-links")
  @RequirePermission("orgs.read")
  @RateLimit(120)
  list(@Param() params: OrgIdDto) {
    return this.links.listForAdmin(params.id);
  }

  @Post(":id/join-links")
  @RequirePermission("orgs.write")
  @Audited({ action: "admin.org.join_link_create", targetType: "org_join_link" })
  @RateLimit(60)
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Param() params: OrgIdDto,
    @Body() body: CreateJoinLinkDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.links.createForAdmin(admin.id, params.id, body, audit);
  }

  @Post(":id/join-links/:linkId/disable")
  @HttpCode(200)
  @RequirePermission("orgs.write")
  @Audited({
    action: "admin.org.join_link_disable",
    targetType: "org_join_link",
    targetParam: "linkId",
  })
  @RateLimit(60)
  disable(@Param() params: OrgLinkParamsDto, @AuditCtx() audit: AuditScope) {
    return this.links.disableForAdmin(params.id, params.linkId, audit);
  }
}

import { Readable } from "node:stream";

import { Body, Controller, Get, Header, Param, Put, Query, StreamableFile } from "@nestjs/common";
import {
  memberLimitSchema,
  orgMemberParamsSchema,
  orgOrderParamsSchema,
  orgUsageQuerySchema,
} from "@wasfa/shared/schemas/org";
import { myOrdersQuerySchema } from "@wasfa/shared/schemas/subscriptions";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";

import { OrgDashboardService } from "./dashboard/org-dashboard.service.js";
import { MemberLimitsService } from "./limits/member-limits.service.js";
import { OrgsService } from "./orgs.service.js";

class OrgIdDto extends createZodDto(idParamSchema) {}
class OrgMemberDto extends createZodDto(orgMemberParamsSchema) {}
class OrgOrderDto extends createZodDto(orgOrderParamsSchema) {}
class MemberLimitDto extends createZodDto(memberLimitSchema) {}
class UsageQueryDto extends createZodDto(orgUsageQuerySchema) {}
class OrdersQueryDto extends createZodDto(myOrdersQuerySchema) {}

/**
 * An organization's billing, for its org admins: dashboard, usage export, member caps, subscription,
 * orders and receipts. Everything checks the caller's role against the database; an organization the
 * caller does not belong to answers `NOT_FOUND`, a member without the role `FORBIDDEN`.
 */
@Controller("orgs")
export class OrgBillingController {
  constructor(
    private readonly dashboard: OrgDashboardService,
    private readonly limits: MemberLimitsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly orgs: OrgsService,
  ) {}

  @Get(":id/dashboard")
  @RateLimit(60)
  overview(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdDto) {
    return this.dashboard.dashboard(user, params.id);
  }

  @Get(":id/usage.csv")
  @RateLimit(10)
  @Header("Cache-Control", "no-store")
  async usage(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdDto,
    @Query() query: UsageQueryDto,
  ): Promise<StreamableFile> {
    const csv = await this.dashboard.usageCsv(user, params.id, query.month);
    // The type travels with the file, not as a route header: an error answered before this point is JSON.
    return new StreamableFile(Readable.from([csv]), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="org-usage.csv"',
    });
  }

  @Put(":id/members/:userId/limit")
  @Audited({
    action: "org.member_limit_set",
    targetType: "org_member",
    targetParam: "userId",
  })
  @RateLimit(30)
  setLimit(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgMemberDto,
    @Body() body: MemberLimitDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.limits.set(user, params.id, params.userId, body.monthlyCreditCap, audit);
  }

  @Get(":id/subscription")
  @RateLimit(60)
  async subscription(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgIdDto) {
    await this.orgs.authorize(user.id, params.id, "org_admin");
    return this.subscriptions.ofOrg(params.id);
  }

  @Get(":id/orders")
  @RateLimit(60)
  async orders(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrgIdDto,
    @Query() query: OrdersQueryDto,
  ) {
    await this.orgs.authorize(user.id, params.id, "org_admin");
    return this.subscriptions.ordersOfOrg(params.id, query.limit, query.cursor);
  }

  @Get(":id/orders/:orderId/receipt")
  @RateLimit(60)
  async receipt(@CurrentUser() user: AuthenticatedUser, @Param() params: OrgOrderDto) {
    await this.orgs.authorize(user.id, params.id, "org_admin");
    return this.subscriptions.receiptOfOrg(params.id, params.orderId);
  }
}

import { Controller, Get, Query } from "@nestjs/common";
import {
  adminBillingOverviewQuerySchema,
  adminCountsQuerySchema,
  adminCountsResponseSchema,
} from "@wasfa/shared/schemas/admin-billing-console";

import { CurrentUser, hasPermission, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireAnyPermission, RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingOverviewService } from "./admin-billing-overview.service.js";

class CountsQueryDto extends createZodDto(adminCountsQuerySchema) {}
class OverviewQueryDto extends createZodDto(adminBillingOverviewQuerySchema) {}

@Controller("admin/billing")
export class AdminBillingOverviewController {
  constructor(private readonly overview: AdminBillingOverviewService) {}

  @Get("overview")
  @RequirePermission("billing.read")
  @RateLimit(30)
  overviewData(@Query() query: OverviewQueryDto) {
    return this.overview.overview(query);
  }

  @Get("counts")
  @RequireAnyPermission("payments.review", "withdrawals.review", "referrals.read")
  @RateLimit(120)
  async counts(@Query() _query: CountsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const counts = await this.overview.counts();
    return adminCountsResponseSchema.parse({
      paymentsToReview: hasPermission(user, "payments.review") ? counts.paymentsToReview : null,
      withdrawalsToReview: hasPermission(user, "withdrawals.review")
        ? counts.withdrawalsToReview
        : null,
      fraudHolds: hasPermission(user, "referrals.read") ? counts.fraudHolds : null,
    });
  }
}

import { Body, Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import {
  adminCouponGrantSchema,
  adminPersonalOfferSchema,
  adminPointsAdjustSchema,
  adminReferralActionSchema,
  adminReferralParamsSchema,
  adminUserParamsSchema,
} from "@wasfa/shared/schemas/admin-user-360";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminUserActionsService } from "./user-actions.service.js";

import type { FastifyRequest } from "fastify";

class UserParamsDto extends createZodDto(adminUserParamsSchema) {}
class ReferralParamsDto extends createZodDto(adminReferralParamsSchema) {}
class CouponGrantDto extends createZodDto(adminCouponGrantSchema) {}
class PersonalOfferDto extends createZodDto(adminPersonalOfferSchema) {}
class PointsAdjustDto extends createZodDto(adminPointsAdjustSchema) {}
class ReferralActionDto extends createZodDto(adminReferralActionSchema) {}

/** Quick actions on the user 360 page (ADMIN-CONSOLE-SPEC §8.4). Every one audits itself. */
@Controller("admin")
export class AdminUserActionsController {
  constructor(private readonly actions: AdminUserActionsService) {}

  @Post("users/:id/coupon-grant")
  @HttpCode(200)
  @RequirePermission("coupons.write")
  @RateLimit(30)
  grantCoupon(
    @Param() params: UserParamsDto,
    @Body() body: CouponGrantDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.grantCoupon(params.id, body.couponId, request);
  }

  @Post("users/:id/personal-offer")
  @HttpCode(200)
  @RequirePermission("promotions.write")
  @RateLimit(30)
  grantOffer(
    @Param() params: UserParamsDto,
    @Body() body: PersonalOfferDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.grantOffer(params.id, body, request);
  }

  @Post("users/:id/points-adjust")
  @HttpCode(200)
  @RequirePermission("rewards.adjust")
  @RequireFreshAuth(10)
  @RateLimit(20)
  adjustPoints(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserParamsDto,
    @Body() body: PointsAdjustDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.adjustPoints(actor, params.id, body, request);
  }

  @Post("referrals/:referralId/release")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RateLimit(30)
  release(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ReferralParamsDto,
    @Body() body: ReferralActionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.referralAction(actor, params.referralId, "release", body.reason, request);
  }

  @Post("referrals/:referralId/void")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RateLimit(30)
  voidReferral(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ReferralParamsDto,
    @Body() body: ReferralActionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.referralAction(actor, params.referralId, "void", body.reason, request);
  }

  @Post("referrals/:referralId/block-referrer")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RateLimit(30)
  blockReferrer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ReferralParamsDto,
    @Body() body: ReferralActionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.actions.referralAction(
      actor,
      params.referralId,
      "block_referrer",
      body.reason,
      request,
    );
  }
}

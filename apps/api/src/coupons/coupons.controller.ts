import { Body, Controller, HttpCode, Inject, Post, Query, Req } from "@nestjs/common";
import { couponCheckSchema, marketQuerySchema } from "@wasfa/shared/schemas/billing";

import { QuoteService } from "../billing/quote.service.js";
import { resolveMarket } from "../catalog/market.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class CouponCheckDto extends createZodDto(couponCheckSchema) {}
class MarketQueryDto extends createZodDto(marketQuerySchema) {}

@Controller("billing/coupons")
export class CouponsController {
  private readonly trust: TrustFn;

  constructor(
    private readonly quotes: QuoteService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  @Post("check")
  @HttpCode(200)
  @RateLimit(30)
  async check(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CouponCheckDto,
    @Query() query: MarketQueryDto,
    @Req() request: FastifyRequest,
  ) {
    const market = resolveMarket(
      query,
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    return this.quotes.checkCouponCode(user.id, body, market, clientIp(request, this.trust));
  }
}

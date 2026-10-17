import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { marketQuerySchema, orderIdParamSchema } from "@wasfa/shared/schemas/billing";
import {
  myOrdersQuerySchema,
  renewQuoteSchema,
  startTrialSchema,
} from "@wasfa/shared/schemas/subscriptions";

import { resolveMarket } from "../catalog/market.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { RequireVerified } from "../common/verified.guard.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { SubscriptionsService } from "./subscriptions.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class TrialDto extends createZodDto(startTrialSchema) {}
class RenewDto extends createZodDto(renewQuoteSchema) {}
class MarketQueryDto extends createZodDto(marketQuerySchema) {}
class OrdersQueryDto extends createZodDto(myOrdersQuerySchema) {}
class OrderIdDto extends createZodDto(orderIdParamSchema) {}

/** The caller's own subscription and order history. Someone else's order answers `NOT_FOUND`. */
@Controller("me")
export class SubscriptionsController {
  private readonly trust: TrustFn;

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  @Get("subscription")
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.mine(user.id);
  }

  @Post("subscription/cancel")
  @HttpCode(200)
  @RateLimit(10)
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.cancel(user.id);
  }

  @Post("subscription/resume")
  @HttpCode(200)
  @RateLimit(10)
  resume(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.resume(user.id);
  }

  /** Same limits as `POST /billing/quote`: it is a quote. */
  @Post("subscription/renew-quote")
  @HttpCode(200)
  @RateLimit(30)
  async renewQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RenewDto,
    @Query() query: MarketQueryDto,
    @Req() request: FastifyRequest,
  ) {
    const market = resolveMarket(
      query,
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    return this.subscriptions.renewQuote(user.id, body, market, clientIp(request, this.trust));
  }

  @Post("trial")
  @HttpCode(200)
  @RequireVerified()
  @RateLimit(5)
  trial(@CurrentUser() user: AuthenticatedUser, @Body() body: TrialDto) {
    return this.subscriptions.startTrial(user.id, body.planKey);
  }

  @Get("orders")
  @RateLimit(60)
  orders(@CurrentUser() user: AuthenticatedUser, @Query() query: OrdersQueryDto) {
    return this.subscriptions.orders(user.id, query.limit, query.cursor);
  }

  @Get("orders/:id/receipt")
  @RateLimit(60)
  receipt(@CurrentUser() user: AuthenticatedUser, @Param() params: OrderIdDto) {
    return this.subscriptions.receipt(user.id, params.id);
  }
}

import { Body, Controller, HttpCode, Inject, Post, Query, Req } from "@nestjs/common";
import { quoteRequestSchema, marketQuerySchema } from "@wasfa/shared/schemas/billing";

import { resolveMarket } from "../catalog/market.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { QuoteService } from "./quote.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class MarketQueryDto extends createZodDto(marketQuerySchema) {}

@Controller("billing")
export class QuoteController {
  private readonly trust: TrustFn;

  constructor(
    private readonly quotes: QuoteService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  /**
   * Prices a purchase for the caller. The body never carries a price; the currency comes from
   * `?currency=` / the visitor's country exactly as in the catalog. A bad coupon is an outcome
   * inside a normal answer, never a 4xx.
   */
  @Post("quote")
  @HttpCode(200)
  @RateLimit(30)
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Query() query: MarketQueryDto,
    @Req() request: FastifyRequest,
  ) {
    const market = resolveMarket(
      query,
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    // A union (plan or pack) cannot be a DTO class: parsed here with the same pipe rules.
    const parsed = parseWithSchema(quoteRequestSchema, body);
    return this.quotes.quote(user.id, parsed, market, clientIp(request, this.trust));
  }
}

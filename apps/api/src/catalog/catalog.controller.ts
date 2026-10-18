import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { marketQuerySchema } from "@wasfa/shared/schemas/billing";

import { Public } from "../common/auth.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { CatalogService } from "./catalog.service.js";
import { resolveMarket } from "./market.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyReply, FastifyRequest } from "fastify";

class MarketQueryDto extends createZodDto(marketQuerySchema) {}

@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Plans, promotions, credit packs, tax mode and payment methods for the visitor's currency.
   * Public and cacheable per currency and country: it holds no coupon, deal, account number or
   * anything personal, and the answer is parsed with the shared schema before it leaves.
   */
  @Public()
  @Get()
  @RateLimit(120)
  async get(
    @Query() query: MarketQueryDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const market = resolveMarket(
      query,
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
    reply.header("vary", "CF-IPCountry");
    return this.catalog.catalog(market);
  }
}

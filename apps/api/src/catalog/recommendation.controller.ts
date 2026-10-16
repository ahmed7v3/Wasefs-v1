import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { marketQuerySchema } from "@wasfa/shared/schemas/billing";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { CatalogService } from "./catalog.service.js";
import { resolveMarket } from "./market.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class MarketQueryDto extends createZodDto(marketQuerySchema) {}

@Controller("me/recommendation")
export class RecommendationController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Plan advice from the caller's own last 30 days of credit use. Numbers only, no sentences. */
  @Get()
  @RateLimit(30)
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketQueryDto,
    @Req() request: FastifyRequest,
  ) {
    const market = resolveMarket(
      query,
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    return this.catalog.recommendation(user.id, market);
  }
}

import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { simulateBillingSchema } from "@wasfa/shared/schemas/billing";

import { QuoteService } from "../../billing/quote.service.js";
import { resolveMarket } from "../../catalog/market.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";
import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";

import type { ApiEnv } from "../../config/env.js";
import type { FastifyRequest } from "fastify";

class SimulateDto extends createZodDto(simulateBillingSchema) {}

@Controller("admin/billing")
export class AdminBillingSimulateController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Post("simulate")
  @HttpCode(200)
  @RequirePermission("billing.read")
  @RateLimit(30)
  async simulate(@Body() body: SimulateDto, @Req() request: FastifyRequest) {
    const market = resolveMarket(
      {},
      request.headers,
      await this.settings.get("currency"),
      this.env.NODE_ENV === "production",
    );
    return this.quotes.simulate(body, market);
  }
}

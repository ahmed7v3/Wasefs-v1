import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import {
  botHitsSchema,
  siteHealthQuerySchema,
  webVitalsBeaconSchema,
} from "@wasfa/shared/schemas/public-site";

import { Public } from "../common/auth.guard.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../common/validation.js";

import { SiteHealthService } from "./site-health.service.js";

class BotHitsDto extends createZodDto(botHitsSchema) {}
class SiteHealthQueryDto extends createZodDto(siteHealthQuerySchema) {}

/** `sendBeacon` posts `text/plain` (no CORS preflight); Fastify hands that over as a string. */
function beaconBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined; // fails the schema, so the caller gets VALIDATION_FAILED
  }
}

@Controller()
export class SiteHealthController {
  constructor(private readonly siteHealth: SiteHealthService) {}

  /**
   * Public and cookie-less. CSRF does not apply: the request carries no credentials and only
   * increments anonymous counters. The per-IP limit bounds counter inflation.
   */
  @Public()
  @Post("public/vitals")
  @HttpCode(204)
  @RateLimit(60, "1 minute")
  async vitals(@Body() body: unknown): Promise<void> {
    await this.siteHealth.recordVitals(parseWithSchema(webVitalsBeaconSchema, beaconBody(body)));
  }

  /** Called by the web proxy over the Docker network; Caddy answers 404 for `/internal/*` on the public domain. */
  @Public()
  @Post("internal/bot-hits")
  @HttpCode(204)
  @RateLimit(600, "1 minute")
  async botHits(@Body() body: BotHitsDto): Promise<void> {
    await this.siteHealth.recordBotHits(body);
  }

  @Get("admin/site-health")
  @RequirePermission("settings.read")
  @RateLimit(60)
  read(@Query() query: SiteHealthQueryDto) {
    return this.siteHealth.read(query.days);
  }
}

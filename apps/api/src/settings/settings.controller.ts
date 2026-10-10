import { Controller, Get, Res } from "@nestjs/common";
import { PUBLIC_SETTING_KEYS, publicSettingsSchema } from "@wasfa/shared/settings";

import { Public } from "../common/auth.guard.js";
import { AllowDuringMaintenance } from "../common/maintenance.guard.js";
import { RateLimit } from "../common/rate-limit.js";

import { SettingsService } from "./settings.service.js";

import type { FastifyReply } from "fastify";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Branding, contact hub, socials, locale, currency, access flags and the free tier: what the web
   * app needs before anyone signs in (including the "maintenance" and "sign-up closed" screens).
   * Public by design; only keys registered as `public` are served, and the response is parsed with
   * the shared schema, so an admin-only key can never leak through here.
   */
  @Public()
  @AllowDuringMaintenance()
  @Get("public")
  @RateLimit(120)
  async publicSettings(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("cache-control", "public, max-age=60");
    return publicSettingsSchema.parse(await this.settings.getMany(PUBLIC_SETTING_KEYS));
  }
}

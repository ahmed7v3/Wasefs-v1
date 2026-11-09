import { Controller, Get, Header, Param } from "@nestjs/common";
import { z } from "zod";

import { Public } from "../common/auth.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { TelegramAdsService } from "./telegram-ads.service.js";

class ClickParamDto extends createZodDto(z.object({ token: z.string().min(1).max(400) })) {}

/**
 * The click side of the tracked Telegram ad links (`<web>/t/<token>`): the web route calls this
 * server-side. No session, no cookie. The destination is read from the stored creative, never from
 * the request, so it is not an open redirect; a bad or expired token answers with the web origin.
 */
@Controller("public/telegram-ads")
export class TelegramAdsPublicController {
  constructor(private readonly ads: TelegramAdsService) {}

  @Public()
  @Get("click/:token")
  @RateLimit(600)
  @Header("Cache-Control", "no-store")
  async click(@Param() params: ClickParamDto): Promise<{ url: string }> {
    return { url: await this.ads.trackClick(params.token) };
  }
}

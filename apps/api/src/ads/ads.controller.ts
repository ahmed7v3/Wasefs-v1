import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from "@nestjs/common";
import {
  adClickSchema,
  adImpressionsSchema,
  adSlotQuerySchema,
  type AdSlotResponse,
} from "@wasfa/shared/ads";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuthService } from "../auth/auth.service.js";
import { Public } from "../common/auth.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { AdsService } from "./ads.service.js";

import type { FastifyRequest } from "fastify";

class SlotQueryDto extends createZodDto(adSlotQuerySchema) {}
class ImpressionsDto extends createZodDto(adImpressionsSchema) {}
class ClickDto extends createZodDto(adClickSchema) {}

/**
 * Public ad delivery (docs/ADS.md §4.3, §5). The web app calls these server-side; none of them sets
 * or reads an ad cookie. The session cookie is read ONLY to learn whether the plan is ad-free, and
 * nothing about the user reaches the response, the token or the counters.
 */
@Controller("public/ads")
export class AdsController {
  constructor(
    private readonly ads: AdsService,
    private readonly auth: AuthService,
  ) {}

  /** Render data of one slot plus its signed token; `{ slot: null }` means "show nothing". */
  @Public()
  @Get("slot")
  @RateLimit(600)
  @Header("Cache-Control", "no-store")
  async slot(
    @Query() query: SlotQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<AdSlotResponse> {
    return this.ads.slot(query, await this.optionalUserId(request));
  }

  /** Batched viewable impressions (50 % visible for 1 s). Always 204: a bad token is not an oracle. */
  @Public()
  @Post("impressions")
  @HttpCode(204)
  @RateLimit(120)
  async impressions(@Body() body: ImpressionsDto): Promise<void> {
    await this.ads.recordImpressions(body.tokens);
  }

  /** Counts a click from the `/a/<token>` redirect and returns the creative's own destination. */
  @Public()
  @Post("click")
  @HttpCode(200)
  @RateLimit(600)
  async click(@Body() body: ClickDto): Promise<{ url: string }> {
    const url = await this.ads.recordClick(body.token);
    if (!url) throw new AppError(ErrorCode.NOT_FOUND);
    return { url };
  }

  private async optionalUserId(request: FastifyRequest): Promise<string | null> {
    if (!request.headers.cookie) return null;
    try {
      return (await this.auth.getSession(request.headers))?.user.id ?? null;
    } catch {
      return null;
    }
  }
}

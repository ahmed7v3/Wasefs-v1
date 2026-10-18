import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  GROWTH_EVENTS_MAX_BODY_BYTES,
  growthEventsRequestSchema,
  growthPromptQuerySchema,
  startTasteSchema,
  tasteGrantParamSchema,
  unsubscribeQuerySchema,
} from "@wasfa/shared/schemas/growth";

import { AuthService } from "../auth/auth.service.js";
import { Public } from "../common/auth.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { SkipOriginCheck } from "../common/origin.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { GrowthService } from "./growth.service.js";
import { PromptsService } from "./prompts.service.js";
import { TasteService } from "./taste.service.js";

import type { FastifyRequest } from "fastify";

class PromptQueryDto extends createZodDto(growthPromptQuerySchema) {}
class StartTasteDto extends createZodDto(startTasteSchema) {}
class TasteParamsDto extends createZodDto(tasteGrantParamSchema) {}
class EventsDto extends createZodDto(growthEventsRequestSchema) {}

/** The caller's own conversion surfaces: the one prompt, the taste, offers, value, experiment arms. */
@Controller("me")
export class MeGrowthController {
  constructor(
    private readonly prompts: PromptsService,
    private readonly taste: TasteService,
    private readonly growth: GrowthService,
  ) {}

  @Get("growth/prompt")
  @RateLimit(120)
  prompt(@CurrentUser() user: AuthenticatedUser, @Query() query: PromptQueryDto) {
    return this.prompts.next(user, query);
  }

  /** Starts an AI analysis: tight limit on top of the weekly taste rule. */
  @Post("taste")
  @HttpCode(201)
  @RateLimit(10, "1 hour")
  startTaste(@CurrentUser() user: AuthenticatedUser, @Body() body: StartTasteDto) {
    return this.taste.start(user, body);
  }

  @Get("taste/:grantId/compare")
  @RateLimit(60)
  compare(@CurrentUser() user: AuthenticatedUser, @Param() params: TasteParamsDto) {
    return this.taste.compare(user, params.grantId);
  }

  @Get("offers")
  @RateLimit(60)
  offers(@CurrentUser() user: AuthenticatedUser) {
    return this.growth.offers(user.id);
  }

  @Get("value")
  @RateLimit(60)
  value(@CurrentUser() user: AuthenticatedUser) {
    return this.growth.value(user.id);
  }

  @Get("experiments")
  @RateLimit(60)
  experiments(@CurrentUser() user: AuthenticatedUser) {
    return this.growth.assignments(user.id);
  }
}

/** Public growth endpoints: the honest proof numbers, first-party event intake, unsubscribe. */
@Public()
@Controller()
export class PublicGrowthController {
  constructor(
    private readonly growth: GrowthService,
    private readonly auth: AuthService,
  ) {}

  @Get("public/proof")
  @RateLimit(60)
  proof() {
    return this.growth.proof();
  }

  /**
   * Batched client events (≤ 20, ≤ 16 KB). Anyone may send the visitor events of the pricing page;
   * a valid session, when present, attaches the user. Never fails the page: bad entries are dropped.
   */
  @Post("growth/events")
  @HttpCode(202)
  @RateLimit(60)
  async events(@Body() body: EventsDto, @Req() request: FastifyRequest) {
    const length = Number(request.headers["content-length"] ?? 0);
    if (length > GROWTH_EVENTS_MAX_BODY_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason: "too_large" } });
    }
    const session = await this.auth.getSession(request.headers).catch(() => null);
    return this.growth.ingest(session?.user.id ?? null, body.events);
  }

  /**
   * Turns marketing mail off. Two callers: the web confirm page (`POST {token}` as JSON) and a mail
   * client's RFC 8058 one-click button (`POST ?token=` with a `List-Unsubscribe=One-Click` form).
   * No session is involved, so the origin check does not apply; the signed token is the authority.
   */
  @Post("unsubscribe")
  @HttpCode(200)
  @SkipOriginCheck()
  @RateLimit(20)
  unsubscribe(
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    // A mail client's one-click POST is a form (`List-Unsubscribe=One-Click`), the token in the URL.
    const oneClick = String(request.headers["content-type"] ?? "").startsWith(
      "application/x-www-form-urlencoded",
    );
    const source = oneClick ? query : (body as Record<string, unknown> | undefined);
    const parsed = unsubscribeQuerySchema.safeParse({ token: source?.["token"] });
    if (!parsed.success) throw new AppError(ErrorCode.NOT_FOUND);
    return this.growth.unsubscribe(parsed.data.token, oneClick ? "one_click" : "unsubscribe_link");
  }
}

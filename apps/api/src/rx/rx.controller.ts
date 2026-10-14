import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  rxCorrectionRequestSchema,
  rxCreateRequestSchema,
  rxItemParamsSchema,
  rxListQuerySchema,
  type RxEvent,
} from "@wasfa/shared/schemas/rx";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { RequireVerified } from "../common/verified.guard.js";

import { RxService } from "./rx.service.js";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";

class CreateRxDto extends createZodDto(rxCreateRequestSchema) {}
class ListRxDto extends createZodDto(rxListQuerySchema) {}
class RxIdParamDto extends createZodDto(idParamSchema) {}
class RxItemParamDto extends createZodDto(rxItemParamsSchema) {}
class CorrectionDto extends createZodDto(rxCorrectionRequestSchema) {}

/** The stream ends after this long even if the analysis never finishes (the job budget is 60 s). */
export const RX_STREAM_MAX_MS = 5 * 60 * 1000;
export const RX_HEARTBEAT_MS = 15_000;

/**
 * Prescription analysis (Task 2.8). Tool routes: a verified, onboarded account. Every route that
 * addresses an analysis by id answers `NOT_FOUND` for someone else's.
 */
@Controller("rx")
@RequireVerified()
export class RxController {
  constructor(private readonly rx: RxService) {}

  @Post()
  @RateLimit(6)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateRxDto) {
    return this.rx.create(user, body);
  }

  @Get()
  @RateLimit(120)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRxDto) {
    return this.rx.list(user, query);
  }

  @Get(":id")
  @RateLimit(240)
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: RxIdParamDto) {
    return this.rx.get(user, params.id);
  }

  /**
   * Server-sent events: the current state first, then `step`, `done` or `failed` events from the
   * worker. The stream closes itself after `done` or `failed`; a `: keep-alive` comment every 15 s
   * keeps proxies from cutting it. Clients without SSE poll `GET /rx/:id`.
   */
  @Get(":id/events")
  @RateLimit(60)
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: RxIdParamDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const raw = reply.raw;
    let opened = false;
    let closed = false;
    let stop: (() => void) | undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      stop?.();
      if (opened && !raw.writableEnded) raw.end();
    };
    const open = (): void => {
      if (opened) return;
      opened = true;
      // Hijack so Nest does not also try to answer; the CORS and helmet headers set so far are kept.
      reply.hijack();
      const headers: OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) headers[name] = value;
      }
      raw.writeHead(200, {
        ...headers,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Caddy and Cloudflare must not buffer the feed.
        "X-Accel-Buffering": "no",
      });
      raw.write("retry: 3000\n\n");
    };
    const heartbeat = setInterval(() => {
      if (opened && !closed) raw.write(": keep-alive\n\n");
    }, RX_HEARTBEAT_MS);
    const lifetime = setTimeout(close, RX_STREAM_MAX_MS);
    request.raw.on("close", close);

    const send = (event: RxEvent): void => {
      if (closed) return;
      open();
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type !== "step") close();
    };

    // Nothing is written before the analysis is known to be the caller's, so a refusal is an
    // ordinary JSON error.
    try {
      stop = await this.rx.openEvents(user, params.id, send);
    } catch (error) {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      throw error;
    }
    if (closed) stop();
  }

  @Delete(":id")
  @HttpCode(204)
  @RateLimit(60)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() params: RxIdParamDto) {
    await this.rx.remove(user, params.id);
  }

  @Post(":id/corrections")
  @HttpCode(200)
  @RateLimit(120)
  correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: RxIdParamDto,
    @Body() body: CorrectionDto,
  ) {
    return this.rx.correct(user, params.id, body);
  }

  @Get(":id/candidates/:itemIndex")
  @RateLimit(120)
  candidates(@CurrentUser() user: AuthenticatedUser, @Param() params: RxItemParamDto) {
    return this.rx.candidates(user, params.id, params.itemIndex);
  }
}

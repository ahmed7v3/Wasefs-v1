import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import {
  captureSessionParamSchema,
  createHandoffSchema,
  handoffFileParamSchema,
  handoffTokenParamSchema,
  handoffUploadSchema,
} from "@wasfa/shared/schemas/handoff";

import { Public } from "../common/auth.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { RequireVerified } from "../common/verified.guard.js";

import { HandoffService } from "./handoff.service.js";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";

class CreateHandoffDto extends createZodDto(createHandoffSchema) {}
class CaptureSessionParamDto extends createZodDto(captureSessionParamSchema) {}
class TokenParamDto extends createZodDto(handoffTokenParamSchema) {}
class FileParamDto extends createZodDto(handoffFileParamSchema) {}
class HandoffUploadDto extends createZodDto(handoffUploadSchema) {}

/** The feed ends after this long; the browser reconnects by itself while the panel is open. */
const STREAM_MAX_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 20_000;

/**
 * Desktop to phone handoff (Task 2.6). The desktop routes need a signed-in, verified account. The
 * `:token` routes are public on purpose: the token is the capability and the service checks it on
 * every call. Limits per IP are here; the per-token and per-user limits live in the service.
 */
@Controller("handoff")
export class HandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @Post()
  @RequireVerified()
  @RateLimit(20)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateHandoffDto,
    @Headers("origin") origin: string | undefined,
  ) {
    return this.handoff.create(user.id, body.captureSessionId, origin);
  }

  /** Server-sent events: `data: {"fileId":"..."}` for every page a phone has finished uploading. */
  @Get(":captureSessionId/events")
  @RequireVerified()
  @RateLimit(30)
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CaptureSessionParamDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const raw = reply.raw;
    let closed = false;
    let stop: (() => void) | undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      stop?.();
      if (!raw.writableEnded) raw.end();
    };
    const heartbeat = setInterval(() => {
      if (!closed) raw.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);
    const lifetime = setTimeout(close, STREAM_MAX_MS);
    request.raw.on("close", close);

    // Nothing is written before this resolves, so a refusal is an ordinary JSON error.
    try {
      stop = await this.handoff.subscribe(user.id, params.captureSessionId, (message) => {
        if (!closed) raw.write(`data: ${message}\n\n`);
      });
    } catch (error) {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      throw error;
    }
    if (closed) {
      stop();
      return;
    }
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
    raw.write("retry: 3000\n\n: connected\n\n");
  }

  @Public()
  @Get(":token")
  @RateLimit(60)
  status(@Param() params: TokenParamDto) {
    return this.handoff.status(params.token);
  }

  @Public()
  @Post(":token/uploads")
  @RateLimit(30)
  createUpload(@Param() params: TokenParamDto, @Body() body: HandoffUploadDto) {
    return this.handoff.createUpload(params.token, body);
  }

  @Public()
  @Post(":token/uploads/:fileId/complete")
  @HttpCode(200)
  @RateLimit(30)
  completeUpload(@Param() params: FileParamDto) {
    return this.handoff.completeUpload(params.token, params.fileId);
  }
}

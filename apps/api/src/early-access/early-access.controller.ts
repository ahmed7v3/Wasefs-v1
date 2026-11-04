import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  earlyDetailsSchema,
  earlyEventSchema,
  earlyJoinSchema,
} from "@wasfa/shared/schemas/early-access";
import { z } from "zod";

import { Public } from "../common/auth.guard.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { EarlyAccessService } from "./early-access.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class JoinDto extends createZodDto(earlyJoinSchema) {}
class DetailsDto extends createZodDto(earlyDetailsSchema) {}
class IdParamDto extends createZodDto(z.object({ id: z.uuid() })) {}
class SlugParamDto extends createZodDto(
  z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }),
) {}

/** `sendBeacon` posts `text/plain` (no CORS preflight); Fastify hands that over as a string. */
function beaconBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined; // fails the schema, so the caller gets VALIDATION_FAILED
  }
}

/** The pre-launch page (`early.wasfa.online`): public, cookie-less, guarded by rate limits and Turnstile. */
@Controller("public/early-access")
export class EarlyAccessController {
  private readonly trust: TrustFn;

  constructor(
    private readonly early: EarlyAccessService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  @Public()
  @Post("ping")
  @HttpCode(204)
  @RateLimit(60, "1 minute")
  async ping(@Req() request: FastifyRequest, @Body() body: unknown): Promise<void> {
    await this.early.ping(
      parseWithSchema(earlyEventSchema, beaconBody(body)),
      this.requestContext(request),
    );
  }

  @Public()
  @Post("join")
  @HttpCode(200)
  @RateLimit(10, "1 minute")
  join(
    @Req() request: FastifyRequest,
    @Body() body: JoinDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    return this.early.join(body, this.requestContext(request), turnstileToken);
  }

  /** Authorised by the signed token from step 1, not by a session: visitors have no account. */
  @Public()
  @Patch("join/:id")
  @RateLimit(20, "1 minute")
  details(
    @Req() request: FastifyRequest,
    @Param() params: IdParamDto,
    @Body() body: DetailsDto,
    @Headers("x-early-token") token: string | undefined,
  ) {
    return this.early.details(params.id, token, body, this.requestContext(request));
  }

  @Public()
  @Get("stats")
  @RateLimit(60, "1 minute")
  @Header("Cache-Control", "public, max-age=60")
  stats() {
    return this.early.stats();
  }

  @Public()
  @Get("link/:slug")
  @RateLimit(60, "1 minute")
  link(@Param() params: SlugParamDto) {
    return this.early.link(params.slug);
  }

  private requestContext(request: FastifyRequest) {
    return { ip: clientIp(request, this.trust), headers: request.headers };
  }
}

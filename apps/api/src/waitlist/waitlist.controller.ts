import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { appWaitlistSchema } from "@wasfa/shared/schemas/public-site";

import { Public } from "../common/auth.guard.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { WaitlistService } from "./waitlist.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class AppWaitlistDto extends createZodDto(appWaitlistSchema) {}

@Controller("public/app-waitlist")
export class WaitlistController {
  private readonly trust: TrustFn;

  constructor(
    private readonly waitlist: WaitlistService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  /** Public: visitors have no account. Per-IP limits and Turnstile (when configured) are the guard. */
  @Public()
  @Post()
  @HttpCode(202)
  @RateLimit(10, "1 minute")
  async join(
    @Req() request: FastifyRequest,
    @Body() body: AppWaitlistDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    await this.waitlist.join(body, { ip: clientIp(request, this.trust), turnstileToken });
    return { received: true as const };
  }
}

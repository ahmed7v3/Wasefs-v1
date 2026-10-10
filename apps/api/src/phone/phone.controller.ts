import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { startPhoneVerificationSchema } from "@wasfa/shared/schemas/phone";

import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { PhoneService } from "./phone.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class StartPhoneVerificationDto extends createZodDto(startPhoneVerificationSchema) {}

/** Phone verification endpoints. The global `AuthGuard` has already resolved the caller. */
@Controller("phone/verify")
export class PhoneController {
  private readonly trust: TrustFn;

  constructor(
    private readonly phone: PhoneService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  @Post("start")
  @HttpCode(200)
  @RateLimit(10, "1 minute")
  async start(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartPhoneVerificationDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    return this.phone.start(user, body.phoneNumber, {
      ip: clientIp(request, this.trust),
      turnstileToken,
    });
  }

  /** Polled every 2 seconds by the verification page. */
  @Get("status")
  @RateLimit(60, "1 minute")
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.phone.status(user);
  }
}

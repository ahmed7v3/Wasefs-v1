import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { startPhoneVerificationSchema } from "@wasfa/shared/schemas/phone";

import { AuthService } from "../auth/auth.service.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { PhoneService } from "./phone.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class StartPhoneVerificationDto extends createZodDto(startPhoneVerificationSchema) {}

/**
 * Phone verification endpoints. The caller is resolved with `AuthService` here; Task 1.6 moves this
 * to the global `AuthGuard` and `@CurrentUser()`.
 */
@Controller("phone/verify")
export class PhoneController {
  private readonly trust: TrustFn;

  constructor(
    private readonly phone: PhoneService,
    private readonly auth: AuthService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  @Post("start")
  @HttpCode(200)
  @RateLimit(10, "1 minute")
  async start(
    @Req() request: FastifyRequest,
    @Body() body: StartPhoneVerificationDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    const session = await this.auth.getSession(request.headers);
    if (!session) throw new AppError(ErrorCode.AUTH_REQUIRED);
    return this.phone.start(session.user, body.phoneNumber, {
      ip: clientIp(request, this.trust),
      turnstileToken,
    });
  }

  /** Polled every 2 seconds by the verification page. */
  @Get("status")
  @RateLimit(60, "1 minute")
  async status(@Req() request: FastifyRequest) {
    const session = await this.auth.getSession(request.headers);
    if (!session) throw new AppError(ErrorCode.AUTH_REQUIRED);
    return this.phone.status(session.user);
  }
}

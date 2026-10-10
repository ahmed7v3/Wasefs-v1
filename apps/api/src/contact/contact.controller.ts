import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { contactMessageSchema } from "@wasfa/shared/schemas/contact";

import { Public } from "../common/auth.guard.js";
import { clientIp, compileTrust, type TrustFn } from "../common/client-ip.js";
import { requestLocale } from "../common/errors.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { ContactService } from "./contact.service.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

class ContactMessageDto extends createZodDto(contactMessageSchema) {}

@Controller("contact")
export class ContactController {
  private readonly trust: TrustFn;

  constructor(
    private readonly contact: ContactService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  /** Public: visitors without an account must be able to reach us. Turnstile and the limits are the guard. */
  @Public()
  @Post()
  @HttpCode(201)
  @RateLimit(10, "1 minute")
  async submit(
    @Req() request: FastifyRequest,
    @Body() body: ContactMessageDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    return this.contact.submit(body, {
      ip: clientIp(request, this.trust),
      turnstileToken,
      locale: requestLocale(request),
      headers: request.headers,
    });
  }
}

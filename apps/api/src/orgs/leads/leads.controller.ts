import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { institutionLeadSchema } from "@wasfa/shared/schemas/org";

import { Public } from "../../common/auth.guard.js";
import { clientIp, compileTrust, type TrustFn } from "../../common/client-ip.js";
import { requestLocale } from "../../common/errors.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";
import { API_ENV } from "../../config/config.module.js";

import { LeadsService } from "./leads.service.js";

import type { ApiEnv } from "../../config/env.js";
import type { FastifyRequest } from "fastify";

class InstitutionLeadDto extends createZodDto(institutionLeadSchema) {}

@Controller("institutions")
export class LeadsController {
  private readonly trust: TrustFn;

  constructor(
    private readonly leads: LeadsService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  /** Public, like the contact form: Turnstile and the fail-closed limits are the guard. */
  @Public()
  @Post("leads")
  @HttpCode(201)
  @RateLimit(10, "1 minute")
  submit(
    @Req() request: FastifyRequest,
    @Body() body: InstitutionLeadDto,
    @Headers("x-turnstile-token") turnstileToken: string | undefined,
  ) {
    return this.leads.submit(body, {
      ip: clientIp(request, this.trust),
      turnstileToken,
      locale: requestLocale(request),
      headers: request.headers,
    });
  }
}

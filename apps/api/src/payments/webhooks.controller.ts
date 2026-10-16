import { Body, Controller, Headers, HttpCode, Param, Post } from "@nestjs/common";
import { BILLING_KEY_PATTERN } from "@wasfa/shared/billing";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { z } from "zod";

import { Public } from "../common/auth.guard.js";
import { SkipOriginCheck } from "../common/origin.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { PaymentsService } from "./payments.service.js";

/** BILLING §5.6: deliveries larger than this are not webhooks we know. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

class GatewayParamDto extends createZodDto(
  z.object({ gateway: z.string().regex(BILLING_KEY_PATTERN) }),
) {}

/**
 * Provider callbacks. No session cookie and no browser: authenticity comes from the provider's
 * signature only, which is why the origin check is skipped here and nowhere else.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":gateway")
  @Public()
  @SkipOriginCheck()
  @HttpCode(200)
  @RateLimit(600)
  async receive(
    @Param() params: GatewayParamDto,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const length = Number(headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > MAX_WEBHOOK_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { httpStatus: 413 });
    }
    const outcome = await this.payments.handleWebhook(params.gateway, body, headers);
    return { received: true, outcome };
  }
}

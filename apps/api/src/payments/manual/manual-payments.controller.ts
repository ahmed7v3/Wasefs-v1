import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  manualOrderIdParamSchema,
  manualPaymentIdParamSchema,
  submitPaymentProofSchema,
} from "@wasfa/shared/schemas/manual-payment";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";
import { RequireVerified } from "../../common/verified.guard.js";

import { ManualPaymentsService } from "./manual-payments.service.js";

class OrderParams extends createZodDto(manualOrderIdParamSchema) {}
class PaymentParams extends createZodDto(manualPaymentIdParamSchema) {}
class ProofBody extends createZodDto(submitPaymentProofSchema) {}

@Controller()
@RequireVerified()
export class ManualPaymentsController {
  constructor(private readonly manual: ManualPaymentsService) {}

  @Get("billing/orders/:id/instructions")
  @RateLimit(60)
  instructions(@CurrentUser() user: AuthenticatedUser, @Param() params: OrderParams) {
    return this.manual.instructions(user.id, params.id);
  }

  @Post("billing/payments/:id/proof")
  @HttpCode(200)
  @RateLimit(30)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: PaymentParams,
    @Body() body: ProofBody,
  ) {
    return this.manual.submit(user.id, params.id, body);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { withdrawalRequestSchema } from "@wasfa/shared/schemas/rewards";
import {
  adminWithdrawalIdSchema,
  payoutDestinationInputSchema,
} from "@wasfa/shared/schemas/withdrawals";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequireFreshAuth } from "../common/fresh-auth.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { WithdrawalsService } from "./withdrawals.service.js";

class IdDto extends createZodDto(adminWithdrawalIdSchema) {}
class DestinationDto extends createZodDto(payoutDestinationInputSchema) {}
class RequestDto extends createZodDto(withdrawalRequestSchema) {}

/** The caller's payout destinations. Values are sealed; only masked text ever comes back. */
@Controller("me/payout-destinations")
export class MePayoutDestinationsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  @RateLimit(60)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawals.destinations(user.id);
  }

  @Post()
  @RateLimit(20, "1 hour")
  add(@CurrentUser() user: AuthenticatedUser, @Body() body: DestinationDto) {
    return this.withdrawals.addDestination(user.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RateLimit(20, "1 hour")
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() params: IdDto): Promise<void> {
    await this.withdrawals.removeDestination(user.id, params.id);
  }
}

/** The caller's cash withdrawals (REFERRALS §8.2). */
@Controller("me/withdrawals")
export class MeWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get("eligibility")
  @RateLimit(60)
  eligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawals.eligibility(user.id);
  }

  @Get()
  @RateLimit(60)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawals.list(user.id);
  }

  @Post()
  @HttpCode(200)
  @RequireFreshAuth(10)
  @RateLimit(20, "1 hour")
  request(@CurrentUser() user: AuthenticatedUser, @Body() body: RequestDto) {
    return this.withdrawals.request(user, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RateLimit(20, "1 hour")
  cancel(@CurrentUser() user: AuthenticatedUser, @Param() params: IdDto) {
    return this.withdrawals.cancel(user.id, params.id);
  }
}

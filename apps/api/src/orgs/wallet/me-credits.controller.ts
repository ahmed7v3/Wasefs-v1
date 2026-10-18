import { Controller, Get, Query } from "@nestjs/common";
import { meCreditsQuerySchema } from "@wasfa/shared/schemas/credits";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { WalletViewService } from "./wallet-view.service.js";

class MeCreditsQueryDto extends createZodDto(meCreditsQuerySchema) {}

/**
 * The caller's credits: the personal wallet and plan, every organization wallet they belong to, and
 * the payer for `?orgId=`. A context the caller is not an active member of answers `NOT_FOUND`.
 */
@Controller("me/credits")
export class MeCreditsController {
  constructor(private readonly wallets: WalletViewService) {}

  @Get()
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: MeCreditsQueryDto) {
    return this.wallets.forUser(user.id, query.orgId);
  }
}

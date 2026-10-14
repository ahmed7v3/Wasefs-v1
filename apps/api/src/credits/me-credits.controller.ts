import { Controller, Get } from "@nestjs/common";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";

import { CreditsService } from "./credits.service.js";

/** The caller's own credits. Personal wallet only for now; organization wallets come with org billing. */
@Controller("me/credits")
export class MeCreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.credits.forUser(user.id);
  }
}

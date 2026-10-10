import { Controller, Get } from "@nestjs/common";
import { flagsResponseSchema } from "@wasfa/shared/settings";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";

import { FlagsService } from "./flags.service.js";

@Controller("flags")
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  /** The caller's own flags, evaluated server-side: rules and other users' ids never leave the api. */
  @Get()
  @RateLimit(60)
  async mine(@CurrentUser() user: AuthenticatedUser) {
    return flagsResponseSchema.parse({ flags: await this.flags.evaluateFor(user) });
  }
}

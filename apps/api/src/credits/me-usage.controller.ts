import { Controller, Get, Query } from "@nestjs/common";
import { meUsageQuerySchema } from "@wasfa/shared/schemas/credits";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { CreditsService } from "./credits.service.js";

class UsageQueryDto extends createZodDto(meUsageQuerySchema) {}

/** The caller's own credit history: amounts and codes, never content. */
@Controller("me/usage")
export class MeUsageController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: UsageQueryDto) {
    return this.credits.usageFor(user.id, query);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Res } from "@nestjs/common";
import { updateReferralCodeSchema } from "@wasfa/shared/schemas/rewards";

import { Public } from "../common/auth.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { ReferralsService } from "./referrals.service.js";

import type { FastifyReply } from "fastify";

class UpdateReferralCodeDto extends createZodDto(updateReferralCodeSchema) {}

/** The caller's own invite code. */
@Controller("me/referral")
export class MeReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.mine(user.id);
  }

  @Patch()
  @HttpCode(200)
  @RateLimit(10, "1 hour")
  rename(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateReferralCodeDto) {
    return this.referrals.rename(user.id, body.code);
  }
}

/**
 * `GET /r/<code>`: an invite link. Public by design; it only sets a first-party cookie and
 * redirects, and answers the same way for a code that does not exist (minus the cookie).
 */
@Public()
@Controller("r")
export class InviteLinkController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get(":code")
  @RateLimit(60)
  async land(
    @Param("code") code: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const landing = await this.referrals.landing(code);
    reply.header("cache-control", "no-store");
    if (landing.cookie !== null) reply.header("set-cookie", landing.cookie);
    reply.redirect(landing.location, 302);
  }
}

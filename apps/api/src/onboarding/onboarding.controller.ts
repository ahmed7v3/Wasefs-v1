import { Body, Controller, Get, HttpCode, Param, Put, Req } from "@nestjs/common";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";

import { OnboardingStepParamDto, OnboardingWelcomeDto } from "./onboarding.schemas.js";
import { OnboardingService } from "./onboarding.service.js";

import type { FastifyRequest } from "fastify";

/** The onboarding wizard (Task 1.7). The global `AuthGuard` has already resolved the caller. */
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @RateLimit(60)
  state(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.state(user);
  }

  /** The dashboard card's "I followed". Declared before `:step`. */
  @Put("followed")
  @RateLimit(30)
  @HttpCode(204)
  async followed(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.onboarding.markFollowed(user);
  }

  /** The one-screen onboarding; declared before `:step` so "welcome" is never read as a step. */
  @Put("welcome")
  @RateLimit(30)
  welcome(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OnboardingWelcomeDto,
  ) {
    return this.onboarding.welcome(user, request, body);
  }

  /** The body schema depends on `:step`, so the service parses it (see `parseSubmission`). */
  @Put(":step")
  @RateLimit(30)
  submit(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OnboardingStepParamDto,
    @Body() body: unknown,
  ) {
    return this.onboarding.submit(user, request, params.step, body);
  }
}

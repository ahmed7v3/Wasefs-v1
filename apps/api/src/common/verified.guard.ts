import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { isPublic } from "./auth.guard.js";
import { OnboardingStatusRepo } from "./onboarding-status.repo.js";

import type { FastifyRequest } from "fastify";

const VERIFIED_KEY = "wasfa:require-verified";

/**
 * For tool routes (Phase 2): the caller must have a verified email **or** a verified phone, and
 * must have finished onboarding. Otherwise `FORBIDDEN` with `details.reason` set to
 * `verification_required` or `onboarding_required`, which the web app turns into the right screen.
 */
export const RequireVerified = () => SetMetadata(VERIFIED_KEY, true);

@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly onboarding: OnboardingStatusRepo,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http" || isPublic(this.reflector, context)) return true;
    const required = this.reflector.getAllAndOverride<boolean | undefined>(VERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true) return true;

    const user = context.switchToHttp().getRequest<FastifyRequest>().authUser;
    if (!user) throw new AppError(ErrorCode.AUTH_REQUIRED);
    if (!user.emailVerified && !user.phoneVerified) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "verification_required" } });
    }
    if (!(await this.onboarding.isDone(user.id))) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "onboarding_required" } });
    }
    return true;
  }
}

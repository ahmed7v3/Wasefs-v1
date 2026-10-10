import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { isPublic } from "./auth.guard.js";

import type { FastifyRequest } from "fastify";

const FRESH_AUTH_KEY = "wasfa:fresh-auth-minutes";

/**
 * For dangerous actions (role changes, suspensions, settings that hold secrets): the session must
 * have proved the person's identity within `minutes`, by signing in or by `POST /auth/reauth`.
 * Otherwise the answer is `AUTH_REQUIRED` with `details.reason = "reauth"` and the web app asks for
 * the password.
 */
export const RequireFreshAuth = (minutes: number) => SetMetadata(FRESH_AUTH_KEY, minutes);

@Injectable()
export class FreshAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http" || isPublic(this.reflector, context)) return true;
    const minutes = this.reflector.getAllAndOverride<number | undefined>(FRESH_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (minutes === undefined) return true;

    const user = context.switchToHttp().getRequest<FastifyRequest>().authUser;
    if (!user) throw new AppError(ErrorCode.AUTH_REQUIRED);
    if (Date.now() - user.session.reauthAt.getTime() > minutes * 60_000) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, {
        details: { reason: "reauth", maxAgeMinutes: minutes },
      });
    }
    return true;
  }
}

import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { SESSION_COOKIE_NAME } from "../auth/auth.config.js";
import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

const SKIP_ORIGIN_KEY = "wasfa:skip-origin";

/**
 * Exempts a route from the origin check. Only for endpoints that are called by other servers and do
 * not use the session cookie (payment webhooks, Phase 3). Never for anything a browser calls.
 */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_KEY, true);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.origin === "null" ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF defence in depth (SameSite=Lax is the first layer): a state-changing request that carries the
 * session cookie must come from one of our web origins, judged by `Origin` or, when a browser
 * leaves it out, `Referer`. A request without the cookie is not riding on a session, so it passes.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.allowed = new Set(env.WEB_ORIGIN);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }
    if (!this.hasSessionCookie(request)) return true;

    const origin = originOf(request.headers.origin) ?? originOf(request.headers.referer);
    if (origin === undefined || !this.allowed.has(origin)) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "origin_not_allowed" } });
    }
    return true;
  }

  private hasSessionCookie(request: FastifyRequest): boolean {
    const cookie = request.headers.cookie;
    // The real name is `__Secure-wasfa.session`; matching the tail covers it and the plain name.
    return typeof cookie === "string" && cookie.includes(`${SESSION_COOKIE_NAME}=`);
  }
}

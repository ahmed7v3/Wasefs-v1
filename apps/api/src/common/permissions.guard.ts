import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { isPublic } from "./auth.guard.js";
import { hasPermission } from "./current-user.js";

import type { Permission } from "@wasfa/shared/permissions";
import type { FastifyRequest } from "fastify";

const PERMISSION_KEY = "wasfa:permissions";

/**
 * The caller must hold every listed permission (`super_admin` holds all). Admin routes live under
 * `/admin/*` and must declare at least one: an `/admin` route without `@RequirePermission` is
 * refused, so forgetting the decorator can never expose it.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

/** True for `/admin` and everything below it, judged by the route pattern Fastify matched. */
export function isAdminRoute(request: FastifyRequest): boolean {
  const pattern = request.routeOptions?.url ?? request.url.split("?")[0] ?? "";
  return pattern === "/admin" || pattern.startsWith("/admin/");
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http" || isPublic(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.authUser;
    if (!user) throw new AppError(ErrorCode.AUTH_REQUIRED);

    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const admin = isAdminRoute(request);

    if (admin && required.length === 0) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "admin_route_unprotected" } });
    }
    if (!required.every((permission) => hasPermission(user, permission))) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }

    if (admin) {
      // Admin access needs a second factor, and a session that actually went through it: an
      // account that switched 2FA on after this session started must sign in again.
      if (!user.twoFactorEnabled) {
        throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "two_factor_required" } });
      }
      if (user.session.mfaVerifiedAt === null) {
        throw new AppError(ErrorCode.AUTH_REQUIRED, { details: { reason: "two_factor_session" } });
      }
    }
    return true;
  }
}

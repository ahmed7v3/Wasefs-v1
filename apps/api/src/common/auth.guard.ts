import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuthService } from "../auth/auth.service.js";
import { RbacService } from "../rbac/rbac.service.js";

import type { AuthenticatedUser } from "./current-user.js";
import type { FastifyRequest } from "fastify";

const PUBLIC_KEY = "wasfa:public";

/**
 * Opts a controller or route out of authentication. The API is deny-by-default: every route that
 * does not say `@Public()` needs a valid session. Use it for health probes, public settings and the
 * `/auth/*` routes (which do their own checks), and for nothing else.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]) ===
    true
  );
}

/**
 * Resolves the session cookie into `request.authUser` or answers `AUTH_REQUIRED`. Suspended and
 * deleted users never get past `AuthService.getSession`, which also destroys their sessions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http" || isPublic(this.reflector, context)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const session = await this.auth.getSession(request.headers);
    if (!session) throw new AppError(ErrorCode.AUTH_REQUIRED);
    const access = await this.rbac.resolve(session.user.id);

    const user: AuthenticatedUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      roles: access.roles,
      permissions: access.permissions,
      isSuperAdmin: access.isSuperAdmin,
      orgIds: access.orgIds,
      twoFactorEnabled: session.user.twoFactorEnabled,
      emailVerified: session.user.emailVerified,
      phoneVerified: session.user.phoneVerified,
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        reauthAt: session.reauthAt,
        mfaVerifiedAt: session.mfaVerifiedAt,
      },
    };
    request.authUser = user;
    return true;
  }
}

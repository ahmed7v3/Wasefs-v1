import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import type { Permission } from "@wasfa/shared/permissions";
import type { FastifyRequest } from "fastify";

/** Who is calling, resolved once per request by the global `AuthGuard`. */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  /** Platform role keys (`support`, `admin`, ...). Empty for an ordinary user. */
  roles: string[];
  /** Resolved from the database (cached 5 minutes in Redis). Complete for `super_admin`. */
  permissions: Permission[];
  isSuperAdmin: boolean;
  /** Organizations the user belongs to. */
  orgIds: string[];
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  session: {
    id: string;
    createdAt: Date;
    /** Last password/TOTP/social proof in this session; `@RequireFreshAuth` reads it. */
    reauthAt: Date;
    /** Set only for sessions created by a completed two-factor challenge. */
    mfaVerifiedAt: Date | null;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `AuthGuard` on every non-public route. */
    authUser?: AuthenticatedUser;
  }
}

/** The authenticated caller. Only valid on routes that are not `@Public()`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<FastifyRequest>().authUser;
  if (!user) throw new AppError(ErrorCode.AUTH_REQUIRED);
  return user;
});

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.isSuperAdmin || user.permissions.includes(permission);
}

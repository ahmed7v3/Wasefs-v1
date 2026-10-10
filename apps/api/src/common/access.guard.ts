import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";

import { AuthGuard } from "./auth.guard.js";
import { FreshAuthGuard } from "./fresh-auth.js";
import { OriginGuard } from "./origin.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { VerifiedGuard } from "./verified.guard.js";

/**
 * The single global guard. It runs the five checks in a fixed order, which Nest does not promise for
 * several `APP_GUARD`s: origin (CSRF), session (deny by default), permissions (and the admin rules),
 * freshness, then verification (`@RequireVerified`: verified email or phone and onboarding done).
 * Each check is its own class so it can be tested and reused on its own.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly origin: OriginGuard,
    private readonly auth: AuthGuard,
    private readonly permissions: PermissionsGuard,
    private readonly fresh: FreshAuthGuard,
    private readonly verified: VerifiedGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.origin.canActivate(context);
    await this.auth.canActivate(context);
    this.permissions.canActivate(context);
    this.fresh.canActivate(context);
    await this.verified.canActivate(context);
    return true;
  }
}

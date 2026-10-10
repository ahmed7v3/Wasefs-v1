import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { SettingsService } from "../settings/settings.service.js";

import type { FastifyRequest } from "fastify";

const ALLOW_KEY = "wasfa:allow-during-maintenance";

/**
 * Keeps a route reachable while `access.maintenanceMode` is on: health probes, sign-in (so admins
 * can get in), `GET /settings/public` and `GET /me` (so the web app can draw the maintenance page and
 * knows who is signed in). Everything else needs this explicitly.
 */
export const AllowDuringMaintenance = () => SetMetadata(ALLOW_KEY, true);

/**
 * While maintenance mode is on, every route answers `503` `{ details: { reason: "maintenance" } }`
 * unless it is marked `@AllowDuringMaintenance()` or the caller holds a platform role (admins keep
 * working). Runs after the session step of `AccessGuard`, so `request.authUser` is set on every
 * non-public route.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed === true) return true;

    if (!(await this.settings.get("access")).maintenanceMode) return true;

    const user = context.switchToHttp().getRequest<FastifyRequest>().authUser;
    if (user !== undefined && user.roles.length > 0) return true;
    throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
      httpStatus: 503,
      details: { reason: "maintenance" },
    });
  }
}

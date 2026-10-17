import { Reflector } from "@nestjs/core";
import { ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import {
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from "../src/common/permissions.guard.js";

import type { AuthenticatedUser } from "../src/common/current-user.js";
import type { ExecutionContext } from "@nestjs/common";

/*
 * `RequirePermission` (every listed permission) and `RequireAnyPermission` (at least one) on real
 * decorated handlers, through the real `Reflector`: super admin holds all, an `/admin` route must
 * declare one of the two, and the two-factor rules do not depend on which one is used.
 */

class Routes {
  @RequireAnyPermission("users.read", "billing.read")
  any(): void {}

  @RequirePermission("billing.read", "billing.write")
  all(): void {}

  @RequirePermission("payments.review")
  @RequireAnyPermission("users.read", "referrals.read")
  both(): void {}

  undeclared(): void {}
}

const guard = new PermissionsGuard(new Reflector());

function user(
  permissions: AuthenticatedUser["permissions"],
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Admin",
    email: "admin@example.com",
    roles: ["admin"],
    permissions,
    isSuperAdmin: false,
    orgIds: [],
    twoFactorEnabled: true,
    emailVerified: true,
    phoneVerified: true,
    session: {
      id: "00000000-0000-7000-8000-000000000002",
      createdAt: new Date(),
      reauthAt: new Date(),
      mfaVerifiedAt: new Date(),
    },
    ...overrides,
  };
}

function context(
  handler: () => void,
  caller: AuthenticatedUser,
  url = "/admin/anything",
): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({ url, routeOptions: { url }, authUser: caller }),
    }),
  } as unknown as ExecutionContext;
}

const allows = (handler: () => void, caller: AuthenticatedUser, url?: string) =>
  guard.canActivate(context(handler, caller, url));
const refusal = (handler: () => void, caller: AuthenticatedUser) => {
  try {
    guard.canActivate(context(handler, caller));
  } catch (error) {
    return error;
  }
  return null;
};

describe("RequireAnyPermission", () => {
  it("passes a caller holding any one of the listed permissions", () => {
    const routes = new Routes();
    expect(allows(routes.any, user(["billing.read"]))).toBe(true);
    expect(allows(routes.any, user(["users.read"]))).toBe(true);
    expect(allows(routes.any, user(["users.read", "billing.read"]))).toBe(true);
  });

  it("refuses a caller holding none of them, however many others they hold", () => {
    const routes = new Routes();
    expect(refusal(routes.any, user([]))).toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(
      refusal(routes.any, user(["billing.write", "payments.review", "users.upgrade"])),
    ).toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("passes a super admin, who holds every permission", () => {
    expect(allows(new Routes().any, user([], { isSuperAdmin: true }))).toBe(true);
  });
});

describe("RequirePermission next to it", () => {
  it("still needs every listed permission", () => {
    const routes = new Routes();
    expect(allows(routes.all, user(["billing.read", "billing.write"]))).toBe(true);
    expect(refusal(routes.all, user(["billing.read"]))).toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(refusal(routes.all, user(["billing.write"]))).toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("needs both kinds when a handler declares both", () => {
    const routes = new Routes();
    expect(allows(routes.both, user(["payments.review", "referrals.read"]))).toBe(true);
    expect(refusal(routes.both, user(["payments.review"]))).toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(refusal(routes.both, user(["users.read", "referrals.read"]))).toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });
});

describe("admin route rules", () => {
  it("refuses an /admin route that declares neither decorator, even for a super admin", () => {
    expect(refusal(new Routes().undeclared, user([], { isSuperAdmin: true }))).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      details: { reason: "admin_route_unprotected" },
    });
  });

  it("does not demand a declaration outside /admin", () => {
    expect(allows(new Routes().undeclared, user([]), "/me/orders")).toBe(true);
  });

  it("keeps the two-factor requirement for either decorator", () => {
    const routes = new Routes();
    const withoutTwoFactor = user(["billing.read", "billing.write"], { twoFactorEnabled: false });
    expect(refusal(routes.any, withoutTwoFactor)).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      details: { reason: "two_factor_required" },
    });
    expect(refusal(routes.all, withoutTwoFactor)).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      details: { reason: "two_factor_required" },
    });
    const noChallenge = user(["billing.read"], {
      session: { ...user([]).session, mfaVerifiedAt: null },
    });
    expect(refusal(routes.any, noChallenge)).toMatchObject({
      code: ErrorCode.AUTH_REQUIRED,
      details: { reason: "two_factor_session" },
    });
  });
});

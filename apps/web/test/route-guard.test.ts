import { describe, expect, it } from "vitest";

import { hasSessionCookie, isProtectedPath, loginPath } from "../src/lib/route-guard";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/history", "/onboarding", "/account", "/account/security"])(
    "protects %s",
    (path) => {
      expect(isProtectedPath(path)).toBe(true);
    },
  );

  it.each([
    "/",
    "/login",
    "/register",
    "/login/two-factor",
    "/dashboardx",
    "/accounts",
    "/healthz",
  ])("leaves %s open", (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });
});

describe("hasSessionCookie", () => {
  it("accepts the dev and the __Secure- production cookie names", () => {
    expect(hasSessionCookie(["theme", "wasfa.session"])).toBe(true);
    expect(hasSessionCookie(["__Secure-wasfa.session"])).toBe(true);
  });

  it("ignores other cookies", () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(["wasfa.session_data", "session", "wasfa.two_factor"])).toBe(false);
  });
});

describe("loginPath", () => {
  it("keeps the whole target, encoded, in `next`", () => {
    expect(loginPath("/account/security?tab=2fa")).toBe(
      "/login?next=%2Faccount%2Fsecurity%3Ftab%3D2fa",
    );
  });
});

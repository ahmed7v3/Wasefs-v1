// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ERROR_CODES } from "@wasfa/shared/errors";
import { ar, t } from "@wasfa/shared/i18n";
import { PERMISSION_KEYS } from "@wasfa/shared/permissions";
import { describe, expect, it, vi } from "vitest";

import { AdminNav } from "../src/components/admin/admin-nav";
import {
  ADMIN_NAV,
  canAccess,
  isNavActive,
  navItemFor,
  visibleNavGroups,
} from "../src/lib/admin-nav";

let pathname = "/admin/users";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const hrefs = (permissions: readonly string[]) =>
  visibleNavGroups(permissions).flatMap((group) => group.items.map((item) => item.href));

describe("visibleNavGroups", () => {
  it("shows only the pages the permissions allow, and drops empty groups", () => {
    expect(hrefs(["users.read", "audit.read"])).toEqual(["/admin", "/admin/users", "/admin/audit"]);
    expect(visibleNavGroups(["users.read", "audit.read"]).map((group) => group.id)).toEqual([
      "overview",
      "people",
      "monitoring",
    ]);
  });

  it("maps every page to its read permission, never to a write permission (evals.run is the one permission that guards a page and its runs)", () => {
    const permissions = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.permission));
    for (const permission of permissions) {
      expect(
        permission === null || permission.endsWith(".read") || permission === "evals.run",
      ).toBe(true);
    }
  });

  it("shows everything to a holder of the whole catalog (super_admin)", () => {
    expect(hrefs(PERMISSION_KEYS)).toEqual([
      "/admin",
      "/admin/users",
      "/admin/orgs",
      "/admin/roles",
      "/admin/settings",
      "/admin/branding",
      "/admin/flags",
      "/admin/whatsapp",
      "/admin/ai",
      "/admin/ai/providers",
      "/admin/ai/models",
      "/admin/ai/routes",
      "/admin/ai/playground",
      "/admin/ai/usage",
      "/admin/ai/evals",
      "/admin/ai/skills",
      "/admin/plans",
      "/admin/credits",
      "/admin/drugs",
      "/admin/drugs/imports",
      "/admin/audit",
      "/admin/issues",
    ]);
  });

  it("shows the AI group only for the permissions of its pages", () => {
    expect(hrefs(["ai.read"])).toEqual([
      "/admin",
      "/admin/ai",
      "/admin/ai/providers",
      "/admin/ai/models",
      "/admin/ai/routes",
      "/admin/ai/playground",
      "/admin/ai/skills",
    ]);
    expect(hrefs(["plans.read", "usage.read"])).toEqual([
      "/admin",
      "/admin/ai/usage",
      "/admin/plans",
      "/admin/credits",
    ]);
    expect(hrefs(["users.read"])).not.toContain("/admin/ai");
    expect(visibleNavGroups(["ai.read"]).map((group) => group.id)).toContain("ai");
    expect(visibleNavGroups(["users.read"]).map((group) => group.id)).not.toContain("ai");
  });

  it("canAccess treats a missing permission as denied and null as open", () => {
    expect(canAccess([], "users.read")).toBe(false);
    expect(canAccess(["users.read"], "users.read")).toBe(true);
    expect(canAccess([], null)).toBe(true);
  });

  it("finds the nav entry of a nested path", () => {
    expect(navItemFor("/admin/issues/abcdef1234")?.href).toBe("/admin/issues");
    expect(navItemFor("/admin")?.href).toBe("/admin");
  });

  it("marks only the longest matching entry as active (/admin/ai vs /admin/ai/models)", () => {
    expect(isNavActive("/admin/ai", "/admin/ai")).toBe(true);
    expect(isNavActive("/admin/ai", "/admin/ai/models")).toBe(false);
    expect(isNavActive("/admin/ai/models", "/admin/ai/models")).toBe(true);
    expect(isNavActive("/admin/ai/models", "/admin/ai/models/anything")).toBe(true);
    expect(isNavActive("/admin/ai", "/admin/ai/unknown")).toBe(true);
    expect(isNavActive("/admin", "/admin/ai")).toBe(false);
    expect(navItemFor("/admin/ai/models")?.href).toBe("/admin/ai/models");
  });
});

describe("AdminNav", () => {
  it("renders only permitted links and marks the current page", () => {
    pathname = "/admin/users";
    render(<AdminNav permissions={["users.read", "audit.read"]} />);
    const nav = screen.getByRole("navigation", { name: t("admin.nav.label") });
    expect(nav).toBeTruthy();
    const current = screen.getByRole("link", { name: t("admin.nav.users") });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: t("admin.nav.audit") })).toBeTruthy();
    expect(screen.queryByRole("link", { name: t("admin.nav.roles") })).toBeNull();
    expect(screen.queryByRole("link", { name: t("admin.nav.settings") })).toBeNull();
    expect(screen.queryByRole("link", { name: t("admin.nav.flags") })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});

describe("AdminNav AI group", () => {
  it("does not mark AI settings as the current page on the models page", () => {
    pathname = "/admin/ai/models";
    render(<AdminNav permissions={["ai.read"]} />);
    expect(
      screen.getByRole("link", { name: t("admin.nav.aiModels") }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: t("admin.nav.ai") }).getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByText(t("admin.nav.group.ai"))).toBeTruthy();
  });
});

describe("admin strings", () => {
  it("explains every error code an issue can carry", () => {
    for (const code of ERROR_CODES) {
      expect(Object.hasOwn(ar, `admin.issue.explain.${code}`), code).toBe(true);
    }
  });
});

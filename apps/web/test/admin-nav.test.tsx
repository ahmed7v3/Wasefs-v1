// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ERROR_CODES } from "@wasfa/shared/errors";
import { ar, t } from "@wasfa/shared/i18n";
import { PERMISSION_KEYS } from "@wasfa/shared/permissions";
import { describe, expect, it, vi } from "vitest";

import { AdminNav } from "../src/components/admin/admin-nav";
import { ADMIN_NAV, canAccess, navItemFor, visibleNavGroups } from "../src/lib/admin-nav";

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

  it("maps every page to its read permission, never to a write permission", () => {
    const permissions = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.permission));
    for (const permission of permissions) {
      expect(permission === null || permission.endsWith(".read")).toBe(true);
    }
  });

  it("shows everything to a holder of the whole catalog (super_admin)", () => {
    expect(hrefs(PERMISSION_KEYS)).toEqual([
      "/admin",
      "/admin/users",
      "/admin/orgs",
      "/admin/roles",
      "/admin/settings",
      "/admin/flags",
      "/admin/audit",
      "/admin/issues",
    ]);
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

describe("admin strings", () => {
  it("explains every error code an issue can carry", () => {
    for (const code of ERROR_CODES) {
      expect(Object.hasOwn(ar, `admin.issue.explain.${code}`), code).toBe(true);
    }
  });
});

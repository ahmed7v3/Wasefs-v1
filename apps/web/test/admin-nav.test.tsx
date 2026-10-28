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
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

const hrefs = (permissions: readonly string[]) =>
  visibleNavGroups(permissions).flatMap((group) => group.items.map((item) => item.href));

describe("visibleNavGroups", () => {
  it("shows only the pages the permissions allow, and drops empty groups", () => {
    // The apps waitlist holds personal e-mail addresses, so it follows `users.read`.
    expect(hrefs(["users.read", "audit.read"])).toEqual([
      "/admin",
      "/admin/users",
      "/admin/growth/waitlist",
      "/admin/audit",
    ]);
    expect(visibleNavGroups(["users.read", "audit.read"]).map((group) => group.id)).toEqual([
      "overview",
      "people",
      "growth",
      "monitoring",
    ]);
  });

  it("maps every page to its read permission, never to a write permission (evals.run, withdrawals.review and alerts.receive guard pages with no separate read permission)", () => {
    const permissions = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.permission));
    for (const permission of permissions) {
      expect(
        permission === null ||
          permission.endsWith(".read") ||
          permission === "evals.run" ||
          permission === "withdrawals.review" ||
          permission === "alerts.receive",
      ).toBe(true);
    }
  });

  it("shows everything to a holder of the whole catalog (super_admin)", () => {
    expect(hrefs(PERMISSION_KEYS)).toEqual([
      "/admin",
      "/admin/billing",
      "/admin/billing/payments",
      "/admin/billing/subscriptions",
      "/admin/billing/orders",
      "/admin/billing/refunds",
      "/admin/billing/plans",
      "/admin/plans",
      "/admin/billing/credit-packs",
      "/admin/billing/promotions",
      "/admin/billing/coupons",
      "/admin/billing/methods",
      "/admin/billing/gateways",
      "/admin/billing/settings",
      "/admin/users",
      "/admin/orgs",
      "/admin/credits",
      "/admin/growth",
      "/admin/growth/referrals",
      "/admin/growth/fraud",
      "/admin/growth/withdrawals",
      "/admin/growth/deals",
      "/admin/growth/experiments",
      "/admin/growth/waitlist",
      "/admin/growth/settings",
      "/admin/alerts",
      "/admin/notifications",
      "/admin/whatsapp",
      "/admin/whatsapp/agent",
      "/admin/content?type=article",
      "/admin/content?type=guide",
      "/admin/content?type=glossary",
      "/admin/content?type=page",
      "/admin/content/review",
      "/admin/content/calendar",
      "/admin/media",
      "/admin/content/taxonomy",
      "/admin/content/people",
      "/admin/content/redirects",
      "/admin/settings#group-content",
      "/admin/ai",
      "/admin/ai/providers",
      "/admin/ai/models",
      "/admin/ai/routes",
      "/admin/ai/skills",
      "/admin/ai/playground",
      "/admin/ai/usage",
      "/admin/ai/evals",
      "/admin/drugs",
      "/admin/drugs/review",
      "/admin/drugs/imports",
      "/admin/drugs/recognition",
      "/admin/settings",
      "/admin/branding",
      "/admin/site-health",
      "/admin/flags",
      "/admin/roles",
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
      "/admin/ai/skills",
      "/admin/ai/playground",
    ]);
    expect(hrefs(["plans.read", "usage.read"])).toEqual([
      "/admin",
      "/admin/plans",
      "/admin/credits",
      "/admin/ai/usage",
    ]);
    expect(hrefs(["users.read"])).not.toContain("/admin/ai");
    expect(visibleNavGroups(["ai.read"]).map((group) => group.id)).toContain("ai");
    expect(visibleNavGroups(["users.read"]).map((group) => group.id)).not.toContain("ai");
  });

  it("shows the content group to readers of content, and the settings link only with settings.read", () => {
    expect(hrefs(["content.read"])).toEqual([
      "/admin",
      "/admin/content?type=article",
      "/admin/content?type=guide",
      "/admin/content?type=glossary",
      "/admin/content?type=page",
      "/admin/content/review",
      "/admin/content/calendar",
      "/admin/media",
      "/admin/content/taxonomy",
      "/admin/content/people",
      "/admin/content/redirects",
    ]);
    expect(hrefs(["content.read", "settings.read"])).toContain("/admin/settings#group-content");
    expect(visibleNavGroups(["content.read"]).map((group) => group.id)).toContain("content");
    expect(visibleNavGroups(["users.read"]).map((group) => group.id)).not.toContain("content");
  });

  it("shows the WhatsApp agent page to wa_agent.read, and only the longest entry is active there", () => {
    expect(hrefs(["wa_agent.read"])).toEqual(["/admin", "/admin/whatsapp/agent"]);
    expect(hrefs(["settings.read"])).not.toContain("/admin/whatsapp/agent");
    expect(isNavActive("/admin/whatsapp", "/admin/whatsapp/agent")).toBe(false);
    expect(isNavActive("/admin/whatsapp/agent", "/admin/whatsapp/agent")).toBe(true);
    expect(navItemFor("/admin/whatsapp/agent")?.href).toBe("/admin/whatsapp/agent");
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

describe("isNavActive with query strings", () => {
  it("highlights the ?type= entry that matches and no other", () => {
    expect(isNavActive("/admin/content?type=guide", "/admin/content", "type=guide")).toBe(true);
    expect(isNavActive("/admin/content?type=article", "/admin/content", "type=guide")).toBe(false);
    expect(isNavActive("/admin/content?type=article", "/admin/content", "")).toBe(false);
    // Extra params (filters) do not break the match.
    expect(
      isNavActive("/admin/content?type=guide", "/admin/content", "type=guide&status=draft"),
    ).toBe(true);
    // An editor page or another content screen never lights up a list entry.
    expect(isNavActive("/admin/content?type=article", "/admin/content/abc", "type=article")).toBe(
      false,
    );
    expect(isNavActive("/admin/content?type=article", "/admin/content/review", "")).toBe(false);
  });

  it("keeps the plain entries working next to them", () => {
    expect(isNavActive("/admin/content/review", "/admin/content/review")).toBe(true);
    expect(isNavActive("/admin/media", "/admin/media")).toBe(true);
    expect(isNavActive("/admin/settings", "/admin/settings")).toBe(true);
  });

  it("never marks the settings deep link as the current page", () => {
    expect(isNavActive("/admin/settings#group-content", "/admin/settings")).toBe(false);
    expect(navItemFor("/admin/settings")?.href).toBe("/admin/settings");
  });

  it("finds the entry of the page title from the query string", () => {
    expect(navItemFor("/admin/content", "type=glossary")?.href).toBe(
      "/admin/content?type=glossary",
    );
    expect(navItemFor("/admin/content/calendar")?.href).toBe("/admin/content/calendar");
  });
});

describe("AdminNav", () => {
  it("renders only permitted links and marks the current page", () => {
    pathname = "/admin/users";
    search = "";
    render(<AdminNav permissions={["users.read", "audit.read"]} />);
    const nav = screen.getByRole("navigation", { name: t("admin.nav.label") });
    expect(nav).toBeTruthy();
    const current = screen.getByRole("link", { name: t("admin.nav.users") });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: t("admin.nav.audit") })).toBeTruthy();
    expect(screen.queryByRole("link", { name: t("admin.nav.roles") })).toBeNull();
    expect(screen.queryByRole("link", { name: t("admin.nav.settings") })).toBeNull();
    expect(screen.queryByRole("link", { name: t("admin.nav.flags") })).toBeNull();
    expect(screen.getByRole("link", { name: t("admin.nav.waitlist") })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
});

describe("AdminNav content group", () => {
  it("marks the list of the current ?type= as the page, and only that one", () => {
    pathname = "/admin/content";
    search = "type=guide";
    render(<AdminNav permissions={["content.read"]} />);
    expect(screen.getByText(t("admin.nav.group.content"))).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: t("admin.nav.content.guides") })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: t("admin.nav.content.articles") })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: t("admin.nav.content.review") })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});

describe("AdminNav AI group", () => {
  it("does not mark AI settings as the current page on the models page", () => {
    pathname = "/admin/ai/models";
    search = "";
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

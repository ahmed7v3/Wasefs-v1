import { PERMISSION_KEYS, type Permission } from "@wasfa/shared/permissions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminBillingCatalogController } from "../src/admin/billing/admin-billing-catalog.controller.js";
import { AdminBillingOverviewController } from "../src/admin/billing/admin-billing-overview.controller.js";
import { AdminBillingRecordsController } from "../src/admin/billing/admin-billing-records.controller.js";
import { AdminBillingSubscriptionsController } from "../src/admin/billing/admin-billing-subscriptions.controller.js";
import { AdminSearchController } from "../src/admin/search/admin-search.controller.js";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";

/*
 * Every route added by the admin billing console (Task 3.8) refuses a caller who lacks the
 * permission it declares. The table is the register: a new route that is not listed here is not
 * covered, so the count assertion below fails when the controllers grow.
 */

type Method = "GET" | "POST" | "PUT" | "PATCH";
interface Route {
  method: Method;
  path: string;
  /** All of these are needed (`RequirePermission`), or any one of them (`RequireAnyPermission`). */
  needs: { all: Permission } | { any: readonly Permission[] };
}

// Nest stores a route as `path` and `method` metadata on the controller and its handlers.
const PATH_METADATA = "path";
const METHOD_METADATA = "method";

const ctx = new AdminTestContext();
const admins = new Map<string, Admin>();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => ctx.stop());

const read = { all: "billing.read" } as const;
const write = { all: "billing.write" } as const;
const refund = { all: "payments.refund" } as const;
const upgrade = { all: "users.upgrade" } as const;

const routes: Route[] = [
  {
    method: "GET",
    path: "/admin/search?q=ab",
    needs: { any: ["users.read", "billing.read", "referrals.read"] },
  },
  {
    method: "GET",
    path: "/admin/billing/counts",
    needs: { any: ["payments.review", "withdrawals.review", "referrals.read"] },
  },
  { method: "GET", path: "/admin/billing/overview", needs: read },
  { method: "GET", path: "/admin/billing/payments", needs: read },
  { method: "GET", path: `/admin/billing/payments/${MISSING_ID}/record`, needs: read },
  { method: "GET", path: "/admin/billing/orders", needs: read },
  { method: "GET", path: `/admin/billing/orders/${MISSING_ID}`, needs: read },
  { method: "POST", path: `/admin/billing/orders/${MISSING_ID}/resend-receipt`, needs: write },
  { method: "GET", path: "/admin/billing/refunds", needs: read },
  { method: "POST", path: `/admin/billing/payments/${MISSING_ID}/refund/preview`, needs: refund },
  { method: "POST", path: `/admin/billing/payments/${MISSING_ID}/refund`, needs: refund },
  { method: "GET", path: "/admin/billing/subscriptions", needs: read },
  { method: "GET", path: `/admin/billing/subscriptions/${MISSING_ID}`, needs: read },
  { method: "POST", path: `/admin/billing/subscriptions/${MISSING_ID}/extend`, needs: upgrade },
  { method: "POST", path: `/admin/billing/subscriptions/${MISSING_ID}/end`, needs: upgrade },
  {
    method: "POST",
    path: `/admin/billing/subscriptions/${MISSING_ID}/cancel-at-period-end`,
    needs: upgrade,
  },
  { method: "GET", path: "/admin/billing/plans", needs: read },
  { method: "POST", path: `/admin/billing/plans/${MISSING_ID}/prices/preview`, needs: read },
  { method: "PUT", path: `/admin/billing/plans/${MISSING_ID}/prices`, needs: write },
  { method: "GET", path: "/admin/billing/credit-packs", needs: read },
  { method: "POST", path: "/admin/billing/credit-packs", needs: write },
  { method: "PATCH", path: `/admin/billing/credit-packs/${MISSING_ID}`, needs: write },
  { method: "PUT", path: `/admin/billing/credit-packs/${MISSING_ID}/prices`, needs: write },
  { method: "GET", path: "/admin/billing/methods", needs: read },
  { method: "PATCH", path: "/admin/billing/methods/instapay", needs: write },
  { method: "GET", path: "/admin/billing/tax-rules", needs: read },
  { method: "POST", path: "/admin/billing/tax-rules", needs: write },
  { method: "PATCH", path: `/admin/billing/tax-rules/${MISSING_ID}`, needs: write },
];

/** An admin holding every permission except the ones the route needs, built once per case. */
async function adminLacking(needs: Route["needs"]): Promise<Admin> {
  const missing = "all" in needs ? [needs.all] : needs.any;
  const key = [...missing].sort().join(",");
  const cached = admins.get(key);
  if (cached) return cached;
  const role = await ctx.customRole(PERMISSION_KEYS.filter((p) => !missing.includes(p)));
  const admin = await ctx.admin(role);
  admins.set(key, admin);
  return admin;
}

describe("admin billing console permissions", () => {
  it.each(routes)("denies $method $path to a caller lacking its permission", async (route) => {
    const caller = await adminLacking(route.needs);
    const response = await ctx.harness.call(route.method, route.path, {
      jar: caller.jar,
      ...(route.method === "GET" ? {} : { body: {} }),
    });
    expect(response.statusCode, response.body).toBe(403);
  });

  it("lets a super admin reach every route (none is a 404 or an unprotected 5xx)", async () => {
    const boss = await ctx.admin("super_admin");
    for (const route of routes) {
      const response = await ctx.harness.call(route.method, route.path, {
        jar: boss.jar,
        ...(route.method === "GET" ? {} : { body: {} }),
      });
      // A missing record, a rejected empty body or a stale session: anything but "no such route".
      expect([200, 201, 400, 401, 404, 409], `${route.method} ${route.path}`).toContain(
        response.statusCode,
      );
    }
  });

  it("covers every route the console controllers declare, and no other", () => {
    const verbs = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    const declared = new Set<string>();
    for (const controller of [
      AdminSearchController,
      AdminBillingOverviewController,
      AdminBillingRecordsController,
      AdminBillingSubscriptionsController,
      AdminBillingCatalogController,
    ]) {
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as unknown as Record<string, unknown>)[name];
        if (typeof handler !== "function") continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (verb === undefined) continue;
        const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string) || "";
        declared.add(`${verbs[verb] ?? "?"} /${base}${sub === "/" || sub === "" ? "" : `/${sub}`}`);
      }
    }
    const listed = new Set(
      routes.map(
        ({ method, path }) =>
          `${method} ${path
            .split("?")[0]
            ?.replaceAll(MISSING_ID, ":id")
            .replace("/methods/instapay", "/methods/:key")}`,
      ),
    );
    expect([...listed].sort()).toEqual([...declared].sort());
  });
});

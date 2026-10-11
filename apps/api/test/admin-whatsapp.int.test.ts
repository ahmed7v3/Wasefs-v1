import {
  adminWhatsappCommandResponseSchema,
  adminWhatsappStatusSchema,
  type AdminWhatsappStatus,
} from "@wasfa/shared/schemas/admin";
import {
  WA_COMMANDS_KEY,
  WA_HEARTBEAT_KEY,
  WA_PAIRING_KEY,
  waCommandSchema,
  type WaConnectionState,
  type WaPairing,
} from "@wasfa/shared/schemas/phone";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Admin, type Person } from "./support/admin-context.js";
import { expectRateLimited, auditRows } from "./support/identity-fixtures.js";

import type { Permission } from "@wasfa/shared/permissions";
import type { LightMyRequestResponse } from "fastify";

const NUMBER = "+201555000111";
const CODE = "ABCD1234";

const ctx = new AdminTestContext();
let settings: SettingsService;

beforeAll(async () => {
  await ctx.start();
  settings = ctx.app.get(SettingsService);
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.redis.del(WA_HEARTBEAT_KEY, WA_PAIRING_KEY, WA_COMMANDS_KEY);
  await settings.set("whatsapp", { number: null }, { actorId: null });
  const auth = await settings.get("auth");
  await settings.set("auth", { ...auth, phoneVerification: "whatsapp_inbound" }, { actorId: null });
});

async function bridgeIs(state: WaConnectionState, at = Date.now()): Promise<void> {
  await ctx.redis.set(WA_HEARTBEAT_KEY, JSON.stringify({ at, state }), "EX", 120);
}

async function queued() {
  const raw = await ctx.redis.lrange(WA_COMMANDS_KEY, 0, -1);
  return raw.map((entry) => waCommandSchema.parse(JSON.parse(entry)));
}

const get = (who: { jar: Person["jar"] }) =>
  ctx.harness.call("GET", "/admin/whatsapp", { jar: who.jar });
const link = (who: { jar: Person["jar"] }, number: unknown = NUMBER) =>
  ctx.harness.call("POST", "/admin/whatsapp/link", {
    jar: who.jar,
    body: { number: number as string },
  });
const unlink = (who: { jar: Person["jar"] }) =>
  ctx.harness.call("POST", "/admin/whatsapp/unlink", { jar: who.jar });
const verification = (who: { jar: Person["jar"] }, body: Record<string, unknown>) =>
  ctx.harness.call("PUT", "/admin/whatsapp/verification", { jar: who.jar, body });

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(reason ? { details: { reason } } : {}) });
}

function statusOf(res: LightMyRequestResponse): AdminWhatsappStatus {
  expect(res.statusCode, res.body).toBe(200);
  return adminWhatsappStatusSchema.parse(res.json());
}

interface Route {
  name: string;
  method: "GET" | "POST" | "PUT";
  url: string;
  needs: Permission;
  max: number;
  fresh: boolean;
  body?: Record<string, unknown>;
}

const ROUTES: Route[] = [
  {
    name: "status",
    method: "GET",
    url: "/admin/whatsapp",
    needs: "settings.read",
    max: 60,
    fresh: false,
  },
  {
    name: "link",
    method: "POST",
    url: "/admin/whatsapp/link",
    needs: "settings.write",
    max: 10,
    fresh: true,
    body: { number: NUMBER },
  },
  {
    name: "unlink",
    method: "POST",
    url: "/admin/whatsapp/unlink",
    needs: "settings.write",
    max: 10,
    fresh: true,
  },
  {
    name: "verification",
    method: "PUT",
    url: "/admin/whatsapp/verification",
    needs: "settings.write",
    max: 10,
    fresh: true,
    body: { enabled: true },
  },
];

const send = (route: Route, who?: { jar: Person["jar"] }) =>
  ctx.harness.call(route.method, route.url, {
    ...(who ? { jar: who.jar } : {}),
    ...(route.body ? { body: route.body } : {}),
  });

describe("every /admin/whatsapp route", () => {
  const lacking = new Map<Permission, Admin>();
  let noSecondFactor: Person;
  let plain: Person;

  beforeAll(async () => {
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    plain = await ctx.harness.signedInUser();
    for (const permission of new Set(ROUTES.map((route) => route.needs))) {
      lacking.set(permission, await ctx.admin(await ctx.roleLacking(permission)));
    }
  }, 180_000);

  for (const route of ROUTES) {
    describe(`${route.method} ${route.name}`, () => {
      it("answers 401 without a session", async () => {
        expectError(await send(route), 401, "AUTH_REQUIRED");
      });

      it("answers 403 to a user without any role", async () => {
        expectError(await send(route, plain), 403, "FORBIDDEN");
      });

      it(`answers 403 to an admin holding everything except ${route.needs}`, async () => {
        const admin = lacking.get(route.needs);
        if (!admin) throw new Error("fixture missing");
        expectError(await send(route, admin), 403, "FORBIDDEN");
      });

      it("answers 403 two_factor_required without a second factor", async () => {
        expectError(await send(route, noSecondFactor), 403, "FORBIDDEN", "two_factor_required");
      });

      it(
        route.fresh ? "asks for a fresh login" : "does not ask for a fresh login",
        async () => {
          const admin = await ctx.admin("super_admin");
          await ctx.makeSessionStale(admin.userId);
          const res = await send(route, admin);
          if (route.fresh) {
            expect(res.statusCode).toBe(401);
            expect(res.json()).toMatchObject({
              code: "AUTH_REQUIRED",
              details: { reason: "reauth", maxAgeMinutes: 10 },
            });
          } else {
            expect(res.body).not.toContain("reauth");
          }
        },
      );

      it(`limits it to ${route.max} per minute`, async () => {
        await expectRateLimited(ctx.harness, {
          method: route.method,
          url: route.url,
          max: route.max,
          ...(route.body ? { body: route.body } : {}),
        });
      }, 60_000);
    });
  }

  it("never queues a command for a refused caller", async () => {
    await bridgeIs("logged_out");
    await send(ROUTES[1] as Route, plain);
    await send(ROUTES[2] as Route, noSecondFactor);
    expect(await queued()).toEqual([]);
  });
});

describe("GET /admin/whatsapp", () => {
  it("reports nothing configured and the bridge down on a fresh install", async () => {
    const admin = await ctx.admin("super_admin");
    expect(statusOf(await get(admin))).toEqual({
      number: null,
      numberSource: null,
      bridge: { status: "down", lastBeatAt: null },
      pairing: null,
      phoneVerification: "whatsapp_inbound",
      available: false,
      unavailableReason: "not_configured",
    });
  });

  it("reflects the heartbeat, the saved number and the switch", async () => {
    const admin = await ctx.admin("super_admin");
    await settings.set("whatsapp", { number: NUMBER }, { actorId: null });
    const at = Date.now() - 10_000;
    await bridgeIs("connected", at);

    const connected = statusOf(await get(admin));
    expect(connected).toMatchObject({
      number: NUMBER,
      numberSource: "setting",
      bridge: { status: "connected", lastBeatAt: new Date(at).toISOString() },
      available: true,
    });

    await bridgeIs("logged_out");
    expect(statusOf(await get(admin))).toMatchObject({
      bridge: { status: "logged_out" },
      available: false,
      unavailableReason: "bridge_down",
    });

    // A heartbeat older than 90 seconds means the bridge is gone, whatever it last said.
    await bridgeIs("connected", Date.now() - 100_000);
    expect(statusOf(await get(admin)).bridge.status).toBe("down");
  });

  it("returns the bridge's answer from wa:pairing, with an ISO expiry", async () => {
    const admin = await ctx.admin("super_admin");
    const expiresAt = Date.now() + 120_000;
    const pairing: WaPairing = {
      id: "cmd-1",
      cmd: "link",
      state: "code",
      code: CODE,
      number: "••••0111",
      expiresAt,
    };
    await ctx.redis.set(WA_PAIRING_KEY, JSON.stringify(pairing), "EX", 180);
    expect(statusOf(await get(admin)).pairing).toEqual({
      ...pairing,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    await ctx.redis.set(WA_PAIRING_KEY, "not json", "EX", 180);
    expect(statusOf(await get(admin)).pairing).toBeNull();
    await ctx.redis.set(WA_PAIRING_KEY, JSON.stringify({ state: "code", code: "<script>" }), "EX", 180);
    expect(statusOf(await get(admin)).pairing).toBeNull();
  });
});

describe("POST /admin/whatsapp/link", () => {
  it("saves the number, queues a valid link command and marks the pairing requested", async () => {
    const admin = await ctx.admin("super_admin");
    await bridgeIs("logged_out");
    const res = await link(admin);
    expect(res.statusCode, res.body).toBe(202);
    const { id } = adminWhatsappCommandResponseSchema.parse(res.json());

    expect(await queued()).toEqual([{ id, cmd: "link", number: "201555000111" }]);
    expect(await ctx.redis.ttl(WA_COMMANDS_KEY)).toBeGreaterThan(0);
    expect((await settings.get("whatsapp")).number).toBe(NUMBER);

    const status = statusOf(await get(admin));
    expect(status.pairing).toEqual({ id, cmd: "link", state: "requested" });
    expect(status.number).toBe(NUMBER);

    const rows = await auditRows(ctx.owner.db, "setting.update", admin.userId);
    expect(rows.some((row) => row.targetId === "whatsapp")).toBe(true);
  });

  it("replaces an older answer so the page never shows a stale one", async () => {
    const admin = await ctx.admin("super_admin");
    await bridgeIs("logged_out");
    await ctx.redis.set(
      WA_PAIRING_KEY,
      JSON.stringify({ id: "old", cmd: "link", state: "linked" }),
      "EX",
      180,
    );
    const { id } = adminWhatsappCommandResponseSchema.parse((await link(admin)).json());
    expect(statusOf(await get(admin)).pairing).toMatchObject({ id, state: "requested" });
  });

  it("rejects a number that is not E.164 with 400 and queues nothing", async () => {
    const admin = await ctx.admin("super_admin");
    await bridgeIs("logged_out");
    for (const bad of ["", "201555000111", "+0123456789", "+20 155 500", "+2015550001112345", 5, null]) {
      expectError(await link(admin, bad), 400, "VALIDATION_FAILED");
    }
    expectError(
      await ctx.harness.call("POST", "/admin/whatsapp/link", { jar: admin.jar, body: {} }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await queued()).toEqual([]);
    expect((await settings.get("whatsapp")).number).toBeNull();
  });

  it("refuses while a number is linked or reconnecting, and while the bridge is down", async () => {
    const admin = await ctx.admin("super_admin");
    for (const state of ["connected", "connecting", "disconnected"] as const) {
      await bridgeIs(state);
      expectError(await link(admin), 409, "CONFLICT", "whatsapp_already_linked");
    }
    await ctx.redis.del(WA_HEARTBEAT_KEY);
    expectError(await link(admin), 502, "UPSTREAM_UNAVAILABLE", "bridge_down");
    expect(await queued()).toEqual([]);
    expect((await settings.get("whatsapp")).number).toBeNull();
  });
});

describe("POST /admin/whatsapp/unlink", () => {
  it("queues an unlink command and audits it", async () => {
    const admin = await ctx.admin("super_admin");
    await bridgeIs("connected");
    const res = await unlink(admin);
    expect(res.statusCode, res.body).toBe(202);
    const { id } = adminWhatsappCommandResponseSchema.parse(res.json());
    expect(await queued()).toEqual([{ id, cmd: "unlink" }]);
    expect(statusOf(await get(admin)).pairing).toEqual({ id, cmd: "unlink", state: "requested" });

    const rows = await auditRows(ctx.owner.db, "whatsapp.unlink", admin.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetType: "whatsapp", targetId: id });
  });

  it("keeps at most the newest 20 commands", async () => {
    const admin = await ctx.admin("super_admin");
    for (let i = 0; i < 22; i += 1) expect((await unlink(admin)).statusCode).toBe(202);
    expect(await ctx.redis.llen(WA_COMMANDS_KEY)).toBe(20);
  }, 30_000);
});

describe("PUT /admin/whatsapp/verification", () => {
  it("switches phone verification off and on, audited as an auth setting change", async () => {
    const admin = await ctx.admin("super_admin");
    await settings.set("whatsapp", { number: NUMBER }, { actorId: null });
    await bridgeIs("connected");

    const off = statusOf(await verification(admin, { enabled: false }));
    expect(off).toMatchObject({
      phoneVerification: "disabled",
      available: false,
      unavailableReason: "disabled",
    });
    expect((await settings.get("auth")).phoneVerification).toBe("disabled");

    const on = statusOf(await verification(admin, { enabled: true }));
    expect(on).toMatchObject({ phoneVerification: "whatsapp_inbound", available: true });

    const rows = await auditRows(ctx.owner.db, "setting.update", admin.userId);
    expect(rows.filter((row) => row.targetId === "auth")).toHaveLength(2);
  });

  it("keeps the other auth settings untouched", async () => {
    const admin = await ctx.admin("super_admin");
    const before = await settings.get("auth");
    await settings.set("auth", { ...before, blockedEmailDomains: ["spam.test"] }, { actorId: null });
    await verification(admin, { enabled: false });
    expect(await settings.get("auth")).toMatchObject({
      blockedEmailDomains: ["spam.test"],
      phoneVerification: "disabled",
    });
  });

  it("rejects a body that is not { enabled: boolean }", async () => {
    const admin = await ctx.admin("super_admin");
    for (const body of [{}, { enabled: "yes" }, { enabled: 1 }]) {
      expectError(await verification(admin, body), 400, "VALIDATION_FAILED");
    }
  });
});

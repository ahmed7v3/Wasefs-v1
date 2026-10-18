import { randomUUID } from "node:crypto";

import { promotions } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

const ctx = new AdminTestContext();
let boss: Admin;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  who = boss,
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function promotionBody(extra: Record<string, unknown> = {}) {
  return {
    name: `Promotion ${++counter}`,
    titleAr: "عرض تجريبي",
    titleEn: "Test promotion",
    kind: "percent",
    value: 1_000,
    ...extra,
  };
}

async function create(extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/admin/billing/promotions", boss, promotionBody(extra));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string; status: string; name: string }>();
}

function expectError(
  res: { statusCode: number; json: () => unknown },
  status: number,
  code: string,
) {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toMatchObject({ code });
}

describe("admin promotion CRUD and lifecycle", () => {
  it("creates, reads, edits, duplicates, deletes drafts and records audit rows", async () => {
    const created = await create();
    const read = await call("GET", `/admin/billing/promotions/${created.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: created.id, status: "draft" });

    const updated = await call("PATCH", `/admin/billing/promotions/${created.id}`, boss, {
      name: "Renamed promotion",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Renamed promotion", status: "draft" });

    const duplicate = await call("POST", `/admin/billing/promotions/${created.id}/duplicate`);
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({
      name: "Renamed promotion (copy)",
      status: "draft",
      redeemedCount: 0,
    });

    const duplicateId = duplicate.json<{ id: string }>().id;
    const removed = await call("DELETE", `/admin/billing/promotions/${duplicateId}`);
    expect(removed.statusCode).toBe(204);
    expect(await ctx.auditRowsFor("promotion.created", created.id)).toHaveLength(1);
    expect(await ctx.auditRowsFor("promotion.updated", created.id)).toHaveLength(1);
    expect(await ctx.auditRowsFor("promotion.duplicated", duplicateId)).toHaveLength(1);
    expect(await ctx.auditRowsFor("promotion.deleted", duplicateId)).toHaveLength(1);
  });

  it("runs draft, scheduled, active, paused and ended transitions with guarded failures", async () => {
    const live = await create();
    expect(
      (await call("POST", `/admin/billing/promotions/${live.id}/publish`)).json(),
    ).toMatchObject({ status: "active" });
    expectError(
      await call("POST", `/admin/billing/promotions/${live.id}/publish`),
      409,
      "CONFLICT",
    );
    expect((await call("POST", `/admin/billing/promotions/${live.id}/pause`)).json()).toMatchObject(
      { status: "paused" },
    );
    expect(
      (await call("POST", `/admin/billing/promotions/${live.id}/resume`)).json(),
    ).toMatchObject({ status: "active" });
    expect((await call("POST", `/admin/billing/promotions/${live.id}/end`)).json()).toMatchObject({
      status: "ended",
    });
    expectError(await call("POST", `/admin/billing/promotions/${live.id}/resume`), 409, "CONFLICT");

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await create({ startsAt: future });
    expect(
      (await call("POST", `/admin/billing/promotions/${scheduled.id}/publish`)).json(),
    ).toMatchObject({ status: "scheduled" });
    expect(
      (await call("POST", `/admin/billing/promotions/${scheduled.id}/pause`)).json(),
    ).toMatchObject({ status: "paused" });
    expect(
      (await call("POST", `/admin/billing/promotions/${scheduled.id}/resume`)).json(),
    ).toMatchObject({ status: "scheduled" });
    expectError(await call("DELETE", `/admin/billing/promotions/${live.id}`), 409, "CONFLICT");
  });

  it("rejects invalid values, scopes, dates and immutable value edits", async () => {
    const badInputs = [
      promotionBody({ value: 0 }),
      promotionBody({ kind: "fixed", value: 100 }),
      promotionBody({ planIds: [randomUUID()] }),
      promotionBody({
        startsAt: "2026-10-20T00:00:00.000Z",
        endsAt: "2026-10-19T00:00:00.000Z",
      }),
      promotionBody({ showCountdown: true }),
    ];
    for (const body of badInputs) {
      expectError(
        await call("POST", "/admin/billing/promotions", boss, body),
        400,
        "VALIDATION_FAILED",
      );
    }
    const row = await create();
    await ctx.owner.db
      .update(promotions)
      .set({ redeemedCount: 1 })
      .where(eq(promotions.id, row.id));
    expectError(
      await call("PATCH", `/admin/billing/promotions/${row.id}`, boss, { value: 2_000 }),
      409,
      "CONFLICT",
    );
  });

  it("requires fresh authentication to publish and resume, and checks read/write permissions", async () => {
    const row = await create();
    const stalePublisher = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stalePublisher.userId);
    expectError(
      await call("POST", `/admin/billing/promotions/${row.id}/publish`, stalePublisher),
      401,
      "AUTH_REQUIRED",
    );
    await call("POST", `/admin/billing/promotions/${row.id}/publish`);
    const paused = await call("POST", `/admin/billing/promotions/${row.id}/pause`);
    expect(paused.statusCode).toBe(201);
    expectError(
      await call("POST", `/admin/billing/promotions/${row.id}/resume`, stalePublisher),
      401,
      "AUTH_REQUIRED",
    );

    const readerRole = await ctx.roleLacking("promotions.write");
    const reader = await ctx.admin(readerRole);
    expect((await call("GET", "/admin/billing/promotions", reader)).statusCode).toBe(200);
    expectError(
      await call("POST", "/admin/billing/promotions", reader, promotionBody()),
      403,
      "FORBIDDEN",
    );

    const billingReaderRole = await ctx.roleLacking("billing.read");
    const noRead = await ctx.admin(billingReaderRole);
    expectError(await call("GET", "/admin/billing/promotions", noRead), 403, "FORBIDDEN");
  });
});

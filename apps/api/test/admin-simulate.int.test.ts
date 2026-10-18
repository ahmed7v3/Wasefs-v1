import { personalOffers, plans, promotions } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

const ctx = new AdminTestContext();
let boss: Admin;
let plusId: string;
let offerPlanVisibility: "hidden" | "public";

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  const [plan] = await ctx.owner.db.select().from(plans).where(eq(plans.key, "plus"));
  if (!plan) throw new Error("plus plan missing");
  plusId = plan.id;
  offerPlanVisibility = plan.visibility;
}, 180_000);

afterAll(async () => {
  if (plusId)
    await ctx.owner.db
      .update(plans)
      .set({ visibility: offerPlanVisibility })
      .where(eq(plans.id, plusId));
  await ctx.stop();
});

const simulate = (body: Record<string, unknown>, who = boss) =>
  ctx.harness.call("POST", "/admin/billing/simulate", { jar: who.jar, body });

describe("admin billing simulator", () => {
  it("prices a new customer and previews a hidden plan without creating a quote", async () => {
    await ctx.owner.db.update(plans).set({ visibility: "hidden" }).where(eq(plans.id, plusId));
    const [promotion] = await ctx.owner.db
      .insert(promotions)
      .values({
        kind: "percent",
        name: "Simulator visible name",
        titleAr: "عرض",
        titleEn: "Promotion",
        value: 2_000,
        status: "active",
        planIds: [plusId],
      })
      .returning({ id: promotions.id });
    if (!promotion) throw new Error("promotion insert failed");
    const beforeKeys = await ctx.redis.keys("billing:quote:*");
    const response = await simulate({ planKey: "plus", months: 1 });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{
      quote: { applied: Record<string, string> } | null;
      error: string | null;
      candidates: {
        id: string;
        source: string;
        name: string | null;
        eligible: boolean;
        chosen: boolean;
      }[];
    }>();
    expect(body.error).toBeNull();
    expect(body.quote?.applied.promotionId).toBe(promotion.id);
    expect(body.candidates).toContainEqual({
      id: promotion.id,
      source: "promotion",
      name: "Simulator visible name",
      kind: "percent",
      aloneSavingMinor: expect.any(Number),
      eligible: true,
      chosen: true,
    });
    expect(await ctx.redis.keys("billing:quote:*")).toEqual(beforeKeys);
    await ctx.owner.db
      .update(promotions)
      .set({ status: "ended" })
      .where(eq(promotions.id, promotion.id));
  });

  it("includes a user's personal offer and marks candidate eligibility and choice", async () => {
    const user = await ctx.harness.signedInUser();
    const [template] = await ctx.owner.db
      .insert(promotions)
      .values({
        kind: "percent",
        name: "Private offer template",
        titleAr: "عرض",
        titleEn: "Offer",
        value: 3_000,
        status: "draft",
        planIds: [plusId],
      })
      .returning({ id: promotions.id });
    if (!template) throw new Error("promotion template missing");
    const [offer] = await ctx.owner.db
      .insert(personalOffers)
      .values({
        ownerUserId: user.userId,
        kind: "welcome",
        promotionId: template.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: personalOffers.id });
    if (!offer) throw new Error("personal offer insert failed");

    const response = await simulate({ planKey: "plus", months: 1, userId: user.userId });
    expect(response.statusCode, response.body).toBe(200);
    const candidate = response
      .json<{ candidates: { id: string; source: string; eligible: boolean; chosen: boolean }[] }>()
      .candidates.find((item) => item.id === offer.id);
    expect(candidate).toMatchObject({ source: "personal_offer", eligible: true, chosen: true });
  });

  it("requires billing.read", async () => {
    const reader = await ctx.admin(await ctx.roleLacking("billing.read"));
    const response = await simulate({ planKey: "plus", months: 1 }, reader);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});

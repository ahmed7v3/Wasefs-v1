import { randomUUID } from "node:crypto";

import {
  auditLogs,
  coupons,
  creditWallets,
  files,
  grant,
  orders,
  paymentMethods,
  payments,
  plans,
  promotions,
  rxAnalyses,
  rxPages,
  users,
  waMessages,
} from "@wasfa/db";
import { waAgentOrderKey, waAgentRxKey, type WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";
import { settingDefault } from "@wasfa/shared/settings";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QuoteInputsRepo } from "../src/billing/quote-inputs.repo.js";
import { QuoteService } from "../src/billing/quote.service.js";
import { CreditsService } from "../src/credits/credits.service.js";
import { OrdersService } from "../src/orders/orders.service.js";
import { ManualPaymentsService } from "../src/payments/manual/manual-payments.service.js";
import { PlansService } from "../src/plans/plans.service.js";
import { RxService } from "../src/rx/rx.service.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { WaAgentCommerceRepo } from "../src/wa-agent/commerce/agent-commerce.repo.js";
import { AgentDiscountService } from "../src/wa-agent/commerce/agent-discount.service.js";
import { AgentRxService } from "../src/wa-agent/commerce/agent-rx.service.js";
import { AgentSubscriptionService } from "../src/wa-agent/commerce/agent-subscription.service.js";
import { WaAgentRepo } from "../src/wa-agent/wa-agent.repo.js";

import { AdminTestContext } from "./support/admin-context.js";
import { buyer, insertProofFile } from "./support/billing-console-fixtures.js";
import { quietLogger } from "./support/wa-agent-commerce-fakes.js";

import type { FilesService } from "../src/files/files.service.js";
import type { AgentCall } from "../src/wa-agent/agent/tools/index.js";

/*
 * Work package C against Postgres and Redis: the coupon the agent mints (one lock, the quote
 * engine's price), the bank-transfer order, the receipt in the human review queue and the rx
 * request made from the customer's pictures. The storage copy and the image worker are replaced by
 * a files fake that returns a row the worker would have processed; everything else is the real service.
 */

const ctx = new AdminTestContext();
const MARKET = { currency: "EGP", country: "EG" };
let phoneCounter = 0;

beforeAll(async () => {
  await ctx.start();
  await ctx.owner.db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  await ctx.owner.db.insert(paymentMethods).values({
    key: "bank_nbe",
    kind: "manual",
    provider: "bank_transfer",
    nameAr: "البنك الأهلي",
    nameEn: "NBE",
    instructionsAr: "حوّل {amount} واكتب {reference}",
    instructionsEn: "Transfer {amount} and write {reference}",
    accountDisplay: "EG120001234567890",
    accountHolder: "Wasfa AI",
    currencies: ["EGP"],
    requiresProof: true,
    reviewSlaMinutes: 90,
    enabled: true,
  });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

/** A signed-in customer whose WhatsApp number is verified, so a chat can link to the account. */
async function linkedCustomer() {
  const person = await buyer(ctx);
  phoneCounter += 1;
  const phone = `+2010${String(60_000_000 + phoneCounter * 11)}`;
  await ctx.owner.db
    .update(users)
    .set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() })
    .where(eq(users.id, person.userId));
  return { ...person, phone };
}

function callFor(
  userId: string,
  conversationId: string = randomUUID(),
  discounts: Partial<ReturnType<typeof settingDefault<"waAgent">>["discounts"]> = {},
): AgentCall {
  const config = settingDefault("waAgent");
  return {
    conversationId,
    userId,
    market: MARKET,
    config: {
      ...config,
      discounts: { ...config.discounts, enabled: true, minUserMessages: 0, ...discounts },
    },
    now: new Date(),
  };
}

/** A conversation linked to the customer with one inbound picture; returns both ids. */
async function chatWithPicture(person: { phone: string }) {
  const repo = ctx.app.get(WaAgentRepo);
  const entry: WaAgentInbound = {
    waMessageId: randomUUID(),
    jid: `${person.phone.slice(1)}@s.whatsapp.net`,
    phone: person.phone,
    direction: "in",
    kind: "image",
    media: { key: `wa/2026/10/${randomUUID()}`, mime: "image/jpeg", bytes: 4_096 },
    ts: Date.now(),
  };
  const { conversation } = await repo.ingest(entry, new Date(Date.now() + 60_000));
  const [message] = await ctx.owner.db
    .select()
    .from(waMessages)
    .where(eq(waMessages.waMessageId, entry.waMessageId));
  if (!message) throw new Error("message not stored");
  return { conversationId: conversation.id, messageId: message.id };
}

describe("offer_discount against the database", () => {
  it("mints one single-use coupon for the user, prices it with the quote engine and audits it", async () => {
    const person = await linkedCustomer();
    const call = callFor(person.userId);
    const offer = await ctx.app.get(AgentDiscountService).offer(call, "plus", 1);
    expect(offer).toMatchObject({ offered: true, reused: false, percentOff: 10, months: 1 });
    const code = String(offer["code"]);
    expect(code).toMatch(/^WA[A-HJKMNP-Z2-9]{6}$/);

    const [coupon] = await ctx.owner.db.select().from(coupons).where(eq(coupons.code, code));
    const [plan] = await ctx.owner.db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.key, "plus"));
    expect(coupon).toMatchObject({
      campaign: "wa_agent",
      targetUserId: person.userId,
      kind: "percent",
      value: 1000,
      status: "active",
      maxRedemptions: 1,
      perOwnerLimit: 1,
      planIds: [plan?.id],
      months: [1],
    });
    const hours = ((coupon?.endsAt?.getTime() ?? 0) - call.now.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);

    const priced = await ctx.app
      .get(QuoteService)
      .quote(
        person.userId,
        { planKey: "plus", months: 1, couponCode: code, methodKey: "bank_nbe" },
        MARKET,
        "test",
        call.now,
      );
    expect(offer["priceAfterMinor"]).toBe(priced.quote.totalMinor);
    expect(Number(offer["priceAfterMinor"])).toBeLessThan(Number(offer["priceBeforeMinor"]));

    const audit = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "coupon.create"), eq(auditLogs.targetId, coupon?.id ?? "")));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBeNull();

    // Asking again hands back the same code; nothing new is minted.
    const again = await ctx.app.get(AgentDiscountService).offer(call, "plus", 1);
    expect(again).toMatchObject({ offered: true, reused: true, code });
  });

  it("lets only one of two concurrent requests take the last coupon of the day", async () => {
    await ctx.owner.db.delete(coupons).where(eq(coupons.campaign, "wa_agent"));
    const [first, second] = await Promise.all([linkedCustomer(), linkedCustomer()]);
    const service = ctx.app.get(AgentDiscountService);
    const results = await Promise.all([
      service.offer(callFor(first.userId, undefined, { dailyCap: 1 }), "plus", 1),
      service.offer(callFor(second.userId, undefined, { dailyCap: 1 }), "plus", 1),
    ]);
    expect(results.filter((result) => result["offered"] === true)).toHaveLength(1);
    expect(results.filter((result) => result["reason"] === "daily_cap")).toHaveLength(1);
    const minted = await ctx.owner.db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.campaign, "wa_agent"));
    expect(minted).toHaveLength(1);
  });

  it("voids a coupon that a better promotion beats, so it neither counts nor gets reused", async () => {
    const person = await linkedCustomer();
    const service = ctx.app.get(AgentDiscountService);
    const call = callFor(person.userId, undefined, { dailyCap: 100 });
    const [promotion] = await ctx.owner.db
      .insert(promotions)
      .values({
        kind: "percent",
        name: "wa-agent-test-50",
        titleAr: "خصم كبير",
        titleEn: "Big discount",
        value: 5000,
        status: "active",
      })
      .returning({ id: promotions.id });
    await expect(service.offer(call, "plus", 1)).resolves.toEqual({
      offered: false,
      reason: "no_better_price",
    });
    const mine = await ctx.owner.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.campaign, "wa_agent"), eq(coupons.targetUserId, person.userId)));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe("ended");

    // The promotion ends: the voided coupon is neither counted nor reused, a fresh one is minted.
    await ctx.owner.db
      .update(promotions)
      .set({ status: "ended" })
      .where(eq(promotions.id, promotion?.id ?? ""));
    const later = await service.offer(call, "plus", 1);
    expect(later).toMatchObject({ offered: true, reused: false });
    expect(later["code"]).not.toBe(mine[0]?.code);
  });

  it("refuses a second coupon over the lifetime limit once the first was used or expired", async () => {
    const person = await linkedCustomer();
    const service = ctx.app.get(AgentDiscountService);
    const first = await service.offer(
      callFor(person.userId, undefined, { dailyCap: 100 }),
      "plus",
      1,
    );
    expect(first).toMatchObject({ offered: true });
    await ctx.owner.db
      .update(coupons)
      .set({ startsAt: new Date(Date.now() - 2_000), endsAt: new Date(Date.now() - 1_000) })
      .where(eq(coupons.code, String(first["code"])));
    await expect(
      service.offer(callFor(person.userId, undefined, { dailyCap: 100 }), "plus", 1),
    ).resolves.toEqual({ offered: false, reason: "lifetime_limit" });
  });
});

describe("start_subscription and attach_receipt against the database", () => {
  it("creates the bank-transfer order once, then files the receipt into the review queue", async () => {
    const person = await linkedCustomer();
    const { conversationId, messageId } = await chatWithPicture(person);
    const call = callFor(person.userId, conversationId);
    const proofFiles: string[] = [];
    const filesFake = {
      importObject: async () => {
        const fileId = await insertProofFile(ctx, person.userId);
        proofFiles.push(fileId);
        return fileId;
      },
      awaitProcessed: () => Promise.resolve("processed" as const),
    } as unknown as FilesService;
    const service = new AgentSubscriptionService(
      ctx.app.get(WaAgentCommerceRepo),
      ctx.app.get(QuoteInputsRepo),
      ctx.app.get(QuoteService),
      ctx.app.get(OrdersService),
      ctx.app.get(ManualPaymentsService),
      filesFake,
      ctx.app.get(WaAgentRepo),
      ctx.app.get(SettingsService),
      ctx.redis,
      quietLogger,
    );

    const started = await service.start(call, { planKey: "plus", months: 1 });
    expect(started).toMatchObject({
      started: true,
      reused: false,
      currency: "EGP",
      couponApplied: false,
      instructions: { bankName: "البنك الأهلي", account: "EG120001234567890" },
      reviewWithinMinutes: 90,
    });
    const again = await service.start(call, { planKey: "plus", months: 1 });
    expect(again).toMatchObject({ started: true, reused: true, orderRef: started["orderRef"] });
    const mine = await ctx.owner.db
      .select()
      .from(orders)
      .where(and(eq(orders.ownerUserId, person.userId), eq(orders.status, "pending_payment")));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.totalMinor).toBe(started["amountMinor"]);
    expect(await ctx.redis.get(waAgentOrderKey(conversationId))).toBe(mine[0]?.id);

    const attached = await service.attachReceipt(call);
    expect(attached).toEqual({
      attached: true,
      orderRef: mine[0]?.number,
      reviewWithinMinutes: 90,
    });
    const [payment] = await ctx.owner.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, mine[0]?.id ?? ""));
    expect(payment).toMatchObject({
      status: "awaiting_review",
      methodKey: "bank_nbe",
      proofFileId: proofFiles[0],
      proofSubmissions: 1,
    });
    const [message] = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.id, messageId));
    expect(message?.meta).toMatchObject({
      attachedAs: { fileId: proofFiles[0], paymentId: payment?.id },
    });
    // The same picture is never attached twice.
    await expect(service.attachReceipt(call)).resolves.toEqual({
      attached: false,
      reason: "no_receipt_found",
    });
  });

  it("returns the full price and the instructions when the coupon does not work", async () => {
    const person = await linkedCustomer();
    const service = new AgentSubscriptionService(
      ctx.app.get(WaAgentCommerceRepo),
      ctx.app.get(QuoteInputsRepo),
      ctx.app.get(QuoteService),
      ctx.app.get(OrdersService),
      ctx.app.get(ManualPaymentsService),
      {} as FilesService,
      ctx.app.get(WaAgentRepo),
      ctx.app.get(SettingsService),
      ctx.redis,
      quietLogger,
    );
    const result = await service.start(callFor(person.userId), {
      planKey: "plus",
      months: 1,
      couponCode: "NOSUCH99",
    });
    expect(result).toMatchObject({
      started: true,
      couponApplied: false,
      couponRejected: "invalid",
      instructions: { reference: expect.stringMatching(/^WSP-/) },
    });
  });
});

describe("analyze_prescription against the database", () => {
  function rxServiceWith(pageIds: string[]) {
    const queue = [...pageIds];
    const filesFake = {
      importObject: () => Promise.resolve(queue.shift() ?? ""),
      awaitProcessed: () => Promise.resolve("processed" as const),
    } as unknown as FilesService;
    return new AgentRxService(
      ctx.app.get(WaAgentCommerceRepo),
      filesFake,
      ctx.app.get(RxService),
      ctx.app.get(PlansService),
      ctx.app.get(CreditsService),
      ctx.app.get(SettingsService),
      ctx.redis,
      quietLogger,
    );
  }

  async function processedPage(userId: string): Promise<string> {
    const id = randomUUID();
    await ctx.owner.db.insert(files).values({
      id,
      ownerUserId: userId,
      createdBy: userId,
      purpose: "rx_page",
      r2Key: `test/${id}.jpg`,
      mime: "image/jpeg",
      bytes: 5_000,
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "b"),
      dhash: "0123456789abcdef",
      status: "processed",
    });
    return id;
  }

  it("creates the analysis from the imported pictures, holds the credits and remembers the chat", async () => {
    const person = await linkedCustomer();
    await grant(ctx.owner.db, { type: "user", id: person.userId }, 30, "2026-10");
    const { conversationId, messageId } = await chatWithPicture(person);
    const page = await processedPage(person.userId);
    const result = await rxServiceWith([page]).analyze(callFor(person.userId, conversationId));
    const perPage = (await ctx.app.get(SettingsService).get("rx")).creditsPerPage;
    expect(result).toEqual({ started: true, pages: 1, credits: perPage, etaSeconds: 60 });

    const [analysis] = await ctx.owner.db
      .select()
      .from(rxAnalyses)
      .where(eq(rxAnalyses.ownerUserId, person.userId));
    expect(analysis).toMatchObject({
      status: "queued",
      mode: "balanced",
      createdBy: person.userId,
    });
    const pages = await ctx.owner.db
      .select()
      .from(rxPages)
      .where(eq(rxPages.analysisId, analysis?.id ?? ""));
    expect(pages.map((row) => row.fileId)).toEqual([page]);
    expect(await ctx.redis.get(waAgentRxKey(analysis?.id ?? ""))).toBe(conversationId);
    const [message] = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.id, messageId));
    expect(message?.meta).toMatchObject({ rxId: analysis?.id });
  });

  it("answers insufficient_credits with the balance and the price, and gives the picture back", async () => {
    const person = await linkedCustomer();
    const { conversationId, messageId } = await chatWithPicture(person);
    const page = await processedPage(person.userId);
    const result = await rxServiceWith([page]).analyze(callFor(person.userId, conversationId));
    const perPage = (await ctx.app.get(SettingsService).get("rx")).creditsPerPage;
    expect(result).toEqual({
      started: false,
      reason: "insufficient_credits",
      balance: 0,
      costPerPage: perPage,
    });
    const [wallet] = await ctx.owner.db
      .select({ balance: creditWallets.balance })
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, person.userId));
    expect(wallet?.balance ?? 0).toBe(0);
    const [message] = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.id, messageId));
    expect(message?.meta).not.toHaveProperty("rxId");
  });
});

import {
  creditLedger,
  creditWallets,
  orders,
  paymentEvents,
  payments,
  referralCodes,
  referralPrograms,
  referrals,
  refunds,
  subscriptions,
  files,
  type Order,
} from "@wasfa/db";
import {
  adminOrderDetailSchema,
  adminOrderListResponseSchema,
  adminPaymentListResponseSchema,
  adminPaymentRecordSchema,
  adminRefundListResponseSchema,
  adminRefundPreviewResponseSchema,
} from "@wasfa/shared/schemas/admin-billing-console";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";
import {
  buyer,
  enableFakeCard,
  insertOrder,
  insertPayment,
  insertProofFile,
  payWithFakeCard,
} from "./support/billing-console-fixtures.js";

/*
 * Payments, orders and refunds of the admin billing console (Task 3.8): filters and keyset paging,
 * the payment drawer without secrets, receipts, the receipt mail, and the refund preview that must
 * equal what the refund then does to the subscription and the wallet.
 */

const ctx = new AdminTestContext();
let boss: Admin;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  await enableFakeCard(ctx);
}, 180_000);

afterAll(async () => ctx.stop());

const get = (path: string, who: { jar: Admin["jar"] } = boss) =>
  ctx.harness.call("GET", path, { jar: who.jar });
const post = (path: string, body: Record<string, unknown>, who: { jar: Admin["jar"] } = boss) =>
  ctx.harness.call("POST", path, { jar: who.jar, body });

const day = (iso: string) => new Date(`${iso}T10:00:00.000Z`);

describe("payments list", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const alice = await ctx.insertUser({
      name: "Alice Lister",
      email: "alice.lister@example.com",
      phone: "+201011112222",
    });
    const rows = [
      ["p1", "2025-01-01", "succeeded", "instapay", 1_000],
      ["p2", "2025-01-02", "awaiting_review", "instapay", 2_000],
      ["p3", "2025-01-03", "awaiting_second_approval", "vodafone_cash", 3_000],
      ["p4", "2025-01-04", "failed", "vodafone_cash", 4_000],
      ["p5", "2025-01-05", "succeeded", "vodafone_cash", 5_000],
    ] as const;
    for (const [key, date, status, methodKey, amount] of rows) {
      const order = await insertOrder(ctx, {
        ownerUserId: alice,
        subtotalMinor: amount,
        createdAt: day(date),
      });
      const payment = await insertPayment(ctx, {
        order,
        status,
        methodKey,
        createdAt: day(date),
      });
      ids[key] = payment.id;
      ids[`${key}.order`] = order.id;
      ids[`${key}.number`] = order.number;
      ids[`${key}.reference`] = payment.reference;
    }
  });

  const list = async (query: string) => {
    const response = await get(`/admin/billing/payments?from=2025-01-01&to=2025-01-31&${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return adminPaymentListResponseSchema.parse(response.json());
  };
  const idsOf = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id);

  it("lists newest first with the customer masked", async () => {
    const page = await list("");
    expect(idsOf(page)).toEqual([ids.p5, ids.p4, ids.p3, ids.p2, ids.p1]);
    expect(page.items[0]).toMatchObject({
      orderId: ids["p5.order"],
      orderNumber: ids["p5.number"],
      reference: ids["p5.reference"],
      planKey: "plus",
      packKey: null,
      months: 1,
      methodKey: "vodafone_cash",
      amountMinor: 5_000,
      currency: "EGP",
      status: "succeeded",
      customer: { type: "user", name: "Alice Lister" },
    });
    expect(page.items[0]?.ageSeconds).toBeGreaterThan(0);
    const body = JSON.stringify(page);
    expect(body).not.toContain("+201011112222");
    expect(body).not.toContain("alice.lister@example.com");
    expect(page.items[0]?.customer.maskedPhone).toMatch(/^\+20\*+222$/);
  });

  it("filters by status, method, amount, date and the review queue", async () => {
    expect(idsOf(await list("status=failed"))).toEqual([ids.p4]);
    expect(idsOf(await list("method=instapay"))).toEqual([ids.p2, ids.p1]);
    expect(idsOf(await list("minAmount=2000&maxAmount=4000"))).toEqual([ids.p4, ids.p3, ids.p2]);
    expect(idsOf(await list("needsReview=true"))).toEqual([ids.p3, ids.p2]);
    // "false" is a value, not "present": it must not switch the filter on.
    expect(idsOf(await list("needsReview=false"))).toHaveLength(5);
    const narrow = await get("/admin/billing/payments?from=2025-01-03&to=2025-01-05");
    expect(idsOf(adminPaymentListResponseSchema.parse(narrow.json()))).toEqual([ids.p4, ids.p3]);
  });

  it("searches by order number, reference or id prefix", async () => {
    expect(idsOf(await list(`q=${ids["p2.number"]}`))).toEqual([ids.p2]);
    expect(idsOf(await list(`q=${ids["p3.reference"]?.toLowerCase()}`))).toEqual([ids.p3]);
    expect(idsOf(await list(`q=${ids.p4?.slice(0, 13)}`))).toEqual([ids.p4]);
    expect(idsOf(await list("q=100%25"))).toEqual([]);
  });

  it("pages with a keyset cursor without gaps or repeats", async () => {
    const first = await list("limit=2");
    expect(idsOf(first)).toEqual([ids.p5, ids.p4]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`limit=2&cursor=${first.nextCursor}`);
    expect(idsOf(second)).toEqual([ids.p3, ids.p2]);
    const third = await list(`limit=2&cursor=${second.nextCursor}`);
    expect(idsOf(third)).toEqual([ids.p1]);
    expect(third.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor and an out-of-range limit", async () => {
    expect((await get("/admin/billing/payments?cursor=garbage")).statusCode).toBe(400);
    expect((await get("/admin/billing/payments?limit=0")).statusCode).toBe(400);
    expect((await get("/admin/billing/payments?limit=101")).statusCode).toBe(400);
    expect((await get("/admin/billing/payments?status=nope")).statusCode).toBe(400);
  });
});

describe("payment record drawer", () => {
  it("shows the order, timeline, refunds and customer without secrets, and audits the view", async () => {
    const userId = await ctx.insertUser({
      name: "Drawer Customer",
      email: "drawer.customer@example.com",
      phone: "+201099998888",
    });
    const proofId = await insertProofFile(ctx, userId);
    const [proof] = await ctx.owner.db.select().from(files).where(eq(files.id, proofId));
    // One earlier paid order and a live subscription, so the customer summary has numbers.
    await insertOrder(ctx, { ownerUserId: userId, subtotalMinor: 5_000 });
    const order = await insertOrder(ctx, {
      ownerUserId: userId,
      subtotalMinor: 9_900,
      months: 3,
      applied: { couponId: MISSING_ID },
    });
    const payment = await insertPayment(ctx, {
      order,
      txnId: "TXN-9876543210",
      senderPhoneMasked: "010****8888",
      senderPhoneEnc: "v1:sealed-sender-phone-ciphertext",
      proofFileId: proofId,
      flags: ["duplicate_image_sha256:WSO-2025-000001"],
    });
    await ctx.owner.db.insert(paymentEvents).values([
      {
        provider: "manual",
        eventId: "evt-1",
        type: "proof_submitted",
        paymentId: payment.id,
        payload: { rawSecret: "payload-must-not-leak" },
        signatureOk: true,
      },
      {
        provider: "manual",
        eventId: "evt-2",
        type: "review_opened",
        paymentId: payment.id,
        payload: {},
        signatureOk: false,
      },
    ]);
    await ctx.owner.db.insert(refunds).values({
      paymentId: payment.id,
      amountMinor: 1_000,
      currency: "EGP",
      reason: "goodwill",
      status: "succeeded",
    });
    const [program] = await ctx.owner.db
      .insert(referralPrograms)
      .values({ key: "drawer_prog", kind: "standard", nameAr: "ب", nameEn: "P" })
      .returning();
    const [code] = await ctx.owner.db
      .insert(referralCodes)
      .values({ code: "DRAWERREF", kind: "campaign", programId: program?.id ?? "" })
      .returning();
    await ctx.owner.db.insert(referrals).values({
      refereeUserId: userId,
      codeId: code?.id ?? "",
      programId: program?.id ?? "",
    });

    const response = await get(`/admin/billing/payments/${payment.id}/record`);
    expect(response.statusCode, response.body).toBe(200);
    const record = adminPaymentRecordSchema.parse(response.json());

    expect(record.payment).toMatchObject({
      id: payment.id,
      reference: payment.reference,
      txnIdMasked: "**********3210",
      senderPhoneMasked: "010****8888",
      hasProof: true,
      flags: ["duplicate_image_sha256:WSO-2025-000001"],
    });
    expect(record.order).toMatchObject({
      number: order.number,
      planKey: "plus",
      months: 3,
      totals: {
        subtotalMinor: 9_900,
        discountMinor: 0,
        taxMinor: 0,
        feeMinor: 0,
        totalMinor: 9_900,
      },
      applied: { couponId: MISSING_ID },
    });
    expect(record.order.quoteLines).toHaveLength(1);
    expect(record.timeline).toEqual([
      { type: "proof_submitted", time: expect.any(String), signatureOk: true },
      { type: "review_opened", time: expect.any(String), signatureOk: false },
    ]);
    expect(record.refunds).toEqual([
      expect.objectContaining({ amountMinor: 1_000, status: "succeeded" }),
    ]);
    expect(record.customer).toMatchObject({
      id: userId,
      name: "Drawer Customer",
      maskedEmail: "d***@example.com",
      previousPaidOrders: 1,
      referralSourceCode: "DRAWERREF",
    });
    expect(record.customer.maskedPhone).toMatch(/^\+20\*+888$/);

    // Nothing sealed, whole or linked: the JSON is the only thing the browser ever gets.
    const body = response.body;
    for (const secret of [
      "TXN-9876543210",
      "sealed-sender-phone",
      "payload-must-not-leak",
      "+201099998888",
      "drawer.customer@example.com",
      proofId,
      proof?.r2Key ?? "never",
    ]) {
      expect(body, secret).not.toContain(secret);
    }

    const audit = await ctx.auditRowsFor("payment.record_opened", payment.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(boss.userId);
  });

  it("answers 404 for an unknown payment and 400 for a malformed id", async () => {
    expect((await get(`/admin/billing/payments/${MISSING_ID}/record`)).statusCode).toBe(404);
    expect((await get("/admin/billing/payments/not-an-id/record")).statusCode).toBe(400);
  });
});

describe("orders", () => {
  let paid: Order;
  let pending: Order;
  let email: string;

  beforeAll(async () => {
    email = "order.owner@example.com";
    const userId = await ctx.insertUser({ name: "Order Owner", email, phone: "+201055554444" });
    paid = await insertOrder(ctx, {
      ownerUserId: userId,
      subtotalMinor: 12_000,
      totalMinor: 12_300,
      createdAt: day("2025-02-01"),
    });
    await insertPayment(ctx, { order: paid, methodKey: "instapay" });
    pending = await insertOrder(ctx, {
      ownerUserId: userId,
      kind: "credit_pack",
      subtotalMinor: 7_900,
      status: "pending_payment",
      createdAt: day("2025-02-02"),
    });
    await insertOrder(ctx, {
      ownerUserId: userId,
      subtotalMinor: 100,
      status: "expired",
      createdAt: day("2025-02-03"),
    });
  });

  const list = async (query: string) => {
    const response = await get(`/admin/billing/orders?from=2025-02-01&to=2025-02-28&${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return adminOrderListResponseSchema.parse(response.json());
  };

  it("lists orders with a masked owner and filters them", async () => {
    const all = await list("");
    expect(all.items.map((item) => item.status)).toEqual(["expired", "pending_payment", "paid"]);
    expect(all.items[2]).toMatchObject({
      id: paid.id,
      number: paid.number,
      kind: "subscription",
      planKey: "plus",
      owner: { type: "user", label: "O***" },
      subtotalMinor: 12_000,
      totalMinor: 12_300,
    });
    expect(JSON.stringify(all)).not.toContain("Order Owner");
    expect((await list("kind=credit_pack")).items.map((item) => item.id)).toEqual([pending.id]);
    expect((await list("status=paid")).items.map((item) => item.id)).toEqual([paid.id]);
    expect((await list(`q=${paid.number}`)).items.map((item) => item.id)).toEqual([paid.id]);
    const paged = await list("limit=1");
    expect(paged.items).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
  });

  it("returns the receipt of a paid order and none for an unpaid one", async () => {
    const response = await get(`/admin/billing/orders/${paid.id}`);
    expect(response.statusCode, response.body).toBe(200);
    const detail = adminOrderDetailSchema.parse(response.json());
    expect(detail).toMatchObject({ number: paid.number, status: "paid", totalMinor: 12_300 });
    expect(detail.payments).toHaveLength(1);
    expect(detail.receipt).toMatchObject({
      number: paid.number,
      buyer: { name: "Order Owner", email: "o***@example.com" },
      totals: { subtotalMinor: 12_000, totalMinor: 12_300, refundedMinor: 0, netPaidMinor: 12_300 },
      payment: { methodKey: "instapay", methodNameEn: "InstaPay" },
    });
    expect(response.body).not.toContain(email);
    expect(response.body).not.toContain("+201055554444");

    const unpaid = adminOrderDetailSchema.parse(
      (await get(`/admin/billing/orders/${pending.id}`)).json(),
    );
    expect(unpaid.receipt).toBeNull();
    expect((await get(`/admin/billing/orders/${MISSING_ID}`)).statusCode).toBe(404);
  });

  it("queues one receipt mail however often the button is pressed, and audits it", async () => {
    const first = await post(`/admin/billing/orders/${paid.id}/resend-receipt`, {});
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({ queued: true });
    const second = await post(`/admin/billing/orders/${paid.id}/resend-receipt`, {});
    expect(second.statusCode, second.body).toBe(201);

    const jobs = await ctx.jobsFor(email);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      template: "payment_receipt",
      to: email,
      orderNumber: paid.number,
      totalMinor: 12_300,
      currency: "EGP",
      link: expect.stringContaining(`/billing/orders/${paid.id}`),
    });
    expect(await ctx.auditRowsFor("order.receipt_resent", paid.id)).toHaveLength(2);
  });

  it("refuses to resend a receipt for an unpaid order or an unknown one", async () => {
    const unpaid = await post(`/admin/billing/orders/${pending.id}/resend-receipt`, {});
    expect(unpaid.statusCode).toBe(409);
    expect(unpaid.json()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "order_not_paid" },
    });
    expect((await post(`/admin/billing/orders/${MISSING_ID}/resend-receipt`, {})).statusCode).toBe(
      404,
    );
  });
});

describe("refund preview and refund", () => {
  const preview = async (paymentId: string, amountMinor: number) => {
    const response = await post(`/admin/billing/payments/${paymentId}/refund/preview`, {
      amountMinor,
    });
    expect(response.statusCode, response.body).toBe(201);
    return adminRefundPreviewResponseSchema.parse(response.json());
  };
  const walletOf = async (userId: string) => {
    const [wallet] = await ctx.owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, userId));
    return wallet;
  };
  const subscriptionOf = async (userId: string) => {
    const [row] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, userId));
    return row;
  };

  it("previews a full and a partial refund of a one-month subscription", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    expect((await walletOf(who.userId))?.balance).toBe(150);

    const full = await preview(paid.paymentId, paid.totalMinor);
    expect(full).toMatchObject({
      paidMinor: paid.totalMinor,
      alreadyRefundedMinor: 0,
      refundableMinor: paid.totalMinor,
      full: true,
      currency: "EGP",
      creditsGranted: 150,
      creditsUsed: 0,
      maxClawback: 150,
      rewardsToReverse: 0,
      couponKept: true,
      subscription: { planKey: "plus", effect: "ends_now" },
    });

    const half = Math.floor(paid.totalMinor / 2);
    const partial = await preview(paid.paymentId, half);
    expect(partial).toMatchObject({
      full: false,
      refundableMinor: paid.totalMinor,
      subscription: { effect: "unchanged", newPeriodEnd: null },
      creditsGranted: 150,
      maxClawback: 150,
    });

    // Previewing changes nothing.
    expect((await subscriptionOf(who.userId))?.status).toBe("active");
    expect((await walletOf(who.userId))?.balance).toBe(150);
    expect(
      await ctx.owner.db.select().from(refunds).where(eq(refunds.paymentId, paid.paymentId)),
    ).toEqual([]);
  });

  it("previews a credit-pack refund with the credits already spent", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { packKey: "pack_100" });
    expect((await walletOf(who.userId))?.balance).toBe(100);
    // 60 of the 100 purchased credits were used.
    await ctx.owner.db
      .update(creditWallets)
      .set({ balance: 40 })
      .where(eq(creditWallets.ownerUserId, who.userId));

    const result = await preview(paid.paymentId, paid.totalMinor);
    expect(result).toMatchObject({
      full: true,
      subscription: null,
      creditsGranted: 100,
      creditsUsed: 60,
      maxClawback: 40,
    });
  });

  it("refuses a preview above the refundable amount, for an unpaid payment and for an unknown one", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { packKey: "pack_100" });
    const tooMuch = await post(`/admin/billing/payments/${paid.paymentId}/refund/preview`, {
      amountMinor: paid.totalMinor + 1,
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json()).toMatchObject({ details: { fields: ["amountMinor"] } });

    const order = await insertOrder(ctx, { ownerUserId: who.userId, subtotalMinor: 500 });
    const waiting = await insertPayment(ctx, { order, status: "awaiting_review" });
    const unpaid = await post(`/admin/billing/payments/${waiting.id}/refund/preview`, {
      amountMinor: 100,
    });
    expect(unpaid.statusCode).toBe(409);
    expect(unpaid.json()).toMatchObject({ details: { reason: "not_refundable" } });

    expect(
      (await post(`/admin/billing/payments/${MISSING_ID}/refund/preview`, { amountMinor: 1 }))
        .statusCode,
    ).toBe(404);
  });

  it("refuses a refund that needs fresh authentication, the admin's own payment, and bad numbers", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const body = {
      amountMinor: paid.totalMinor,
      reason: "customer asked for a refund",
      transferReference: "BANK-REF-ABC",
      clawbackCredits: 0,
    };

    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const needsReauth = await post(`/admin/billing/payments/${paid.paymentId}/refund`, body, stale);
    expect(needsReauth.statusCode).toBe(401);
    expect(needsReauth.json()).toMatchObject({ details: { reason: "reauth" } });

    const tooMuchClawback = await post(`/admin/billing/payments/${paid.paymentId}/refund`, {
      ...body,
      clawbackCredits: 151,
    });
    expect(tooMuchClawback.statusCode).toBe(400);
    expect(tooMuchClawback.json()).toMatchObject({ details: { fields: ["clawbackCredits"] } });

    const tooMuch = await post(`/admin/billing/payments/${paid.paymentId}/refund`, {
      ...body,
      amountMinor: paid.totalMinor + 1,
    });
    expect(tooMuch.statusCode).toBe(400);

    for (const bad of [
      { reason: "no" },
      { transferReference: "" },
      { clawbackCredits: -1 },
      { amountMinor: 0 },
    ]) {
      const response = await post(`/admin/billing/payments/${paid.paymentId}/refund`, {
        ...body,
        ...bad,
      });
      expect(response.statusCode, JSON.stringify(bad)).toBe(400);
    }

    // The admin's own money: refused even though everything else is valid.
    const own = await insertOrder(ctx, { ownerUserId: boss.userId, subtotalMinor: 1_000 });
    const ownPayment = await insertPayment(ctx, { order: own });
    const ownRefund = await post(`/admin/billing/payments/${ownPayment.id}/refund`, {
      ...body,
      amountMinor: 1_000,
    });
    expect(ownRefund.statusCode).toBe(403);
    expect(ownRefund.json()).toMatchObject({ details: { reason: "own_payment" } });

    // Nothing above changed anything.
    expect(
      await ctx.owner.db.select().from(refunds).where(eq(refunds.paymentId, paid.paymentId)),
    ).toEqual([]);
    expect((await subscriptionOf(who.userId))?.status).toBe("active");
  });

  it("applies exactly what the preview promised: a full refund ends the subscription and claws credits back", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const promised = await preview(paid.paymentId, paid.totalMinor);
    const before = await subscriptionOf(who.userId);

    const response = await post(`/admin/billing/payments/${paid.paymentId}/refund`, {
      amountMinor: paid.totalMinor,
      reason: "customer asked for a refund",
      transferReference: "BANK-REF-ABC",
      clawbackCredits: 100,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      status: "succeeded",
      amountMinor: paid.totalMinor,
      currency: "EGP",
    });

    const after = await subscriptionOf(who.userId);
    expect(promised.subscription?.effect).toBe("ends_now");
    expect(after?.status).toBe("expired");
    const promisedEnd = new Date(promised.subscription?.newPeriodEnd ?? "").getTime();
    expect(Math.abs((after?.currentPeriodEnd.getTime() ?? 0) - promisedEnd)).toBeLessThan(30_000);
    expect(after?.currentPeriodEnd.getTime()).toBeLessThanOrEqual(
      before?.currentPeriodEnd.getTime() ?? 0,
    );
    // 100 credits were clawed back, and ending the plan expired the unused rest of its grant.
    expect((await walletOf(who.userId))?.balance).toBe(0);
    const ledger = await ctx.owner.db
      .select({ kind: creditLedger.kind, amount: creditLedger.amount })
      .from(creditLedger)
      .where(eq(creditLedger.walletId, (await walletOf(who.userId))?.id ?? ""));
    expect(ledger).toEqual(
      expect.arrayContaining([
        { kind: "admin_adjust", amount: -100 },
        { kind: "expiry", amount: -50 },
      ]),
    );

    const [payment] = await ctx.owner.db
      .select()
      .from(payments)
      .where(eq(payments.id, paid.paymentId));
    expect(payment?.status).toBe("refunded");
    const [order] = await ctx.owner.db.select().from(orders).where(eq(orders.id, paid.orderId));
    expect(order?.status).toBe("refunded");
    const [refund] = await ctx.owner.db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paid.paymentId));
    expect(refund).toMatchObject({
      status: "succeeded",
      transferReference: "BANK-REF-ABC",
      reason: "customer asked for a refund",
      requestedBy: boss.userId,
    });

    const audit = await ctx.auditRowsFor("payment.refunded", paid.paymentId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      amountMinor: paid.totalMinor,
      clawbackCredits: 100,
      transferReference: "BANK-REF-ABC",
    });
    expect(JSON.stringify(audit[0])).not.toContain("@");

    // A second refund of the same payment has nothing left to give.
    const again = await post(`/admin/billing/payments/${paid.paymentId}/refund/preview`, {
      amountMinor: 1,
    });
    expect(again.statusCode).toBe(409);
  });

  it("applies a partial refund without touching access, and a renewal refund shortens the period", async () => {
    const who = await buyer(ctx);
    const first = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const renewal = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const [subscription] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));

    // Partial refund of the first order: money only.
    const half = Math.floor(first.totalMinor / 2);
    const partial = await post(`/admin/billing/payments/${first.paymentId}/refund`, {
      amountMinor: half,
      reason: "partial goodwill refund",
      transferReference: "BANK-REF-PART",
      clawbackCredits: 0,
    });
    expect(partial.statusCode, partial.body).toBe(201);
    const [unchanged] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    expect(unchanged?.currentPeriodEnd).toEqual(subscription?.currentPeriodEnd);
    expect(unchanged?.status).toBe("active");
    const [partialPayment] = await ctx.owner.db
      .select()
      .from(payments)
      .where(eq(payments.id, first.paymentId));
    expect(partialPayment?.status).toBe("partially_refunded");

    // Full refund of the renewal: one month comes off the end.
    const promised = await preview(renewal.paymentId, renewal.totalMinor);
    expect(promised.subscription).toMatchObject({ effect: "shortened" });
    expect(promised).toMatchObject({ creditsGranted: 0, maxClawback: 0 });
    const done = await post(`/admin/billing/payments/${renewal.paymentId}/refund`, {
      amountMinor: renewal.totalMinor,
      reason: "renewal charged by mistake",
      transferReference: "BANK-REF-RENEW",
      clawbackCredits: 0,
    });
    expect(done.statusCode, done.body).toBe(201);
    const [shortened] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    expect(shortened?.currentPeriodEnd.toISOString()).toBe(promised.subscription?.newPeriodEnd);
    expect(shortened?.status).toBe("active");
  });

  it("lists refunds newest first with their status filter and paging", async () => {
    const response = await get("/admin/billing/refunds?limit=100");
    expect(response.statusCode, response.body).toBe(200);
    const page = adminRefundListResponseSchema.parse(response.json());
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    expect(page.items[0]).toMatchObject({
      status: "succeeded",
      orderNumber: expect.stringMatching(/^WSO-/),
      reason: expect.any(String),
      transferReference: expect.any(String),
    });
    const times = page.items.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const none = adminRefundListResponseSchema.parse(
      (await get("/admin/billing/refunds?status=failed")).json(),
    );
    expect(none.items).toEqual([]);

    const first = adminRefundListResponseSchema.parse(
      (await get("/admin/billing/refunds?limit=1")).json(),
    );
    expect(first.items).toHaveLength(1);
    const second = adminRefundListResponseSchema.parse(
      (await get(`/admin/billing/refunds?limit=1&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

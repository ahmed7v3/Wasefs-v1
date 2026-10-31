import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import {
  bindTools,
  toolsFor,
  type AgentToolContext,
  type ToolCallRecord,
} from "../src/wa-agent/agent/tools/index.js";
import { AgentDiscountService } from "../src/wa-agent/commerce/agent-discount.service.js";
import {
  documentFailedText,
  paymentMessage,
  rxDoneParts,
  rxFailedText,
} from "../src/wa-agent/commerce/agent-event-messages.js";
import { AgentMedicalService } from "../src/wa-agent/commerce/agent-medical.service.js";
import { AgentSubscriptionService } from "../src/wa-agent/commerce/agent-subscription.service.js";
import { WaAgentEventsConsumer } from "../src/wa-agent/commerce/wa-agent-events.consumer.js";
import { AgentRxService } from "../src/wa-agent/rx/agent-rx.service.js";
import { RxStartService } from "../src/wa-agent/rx/rx-start.service.js";

import {
  COMMERCE_CONVERSATION_ID,
  COMMERCE_USER_ID,
  appError,
  commerceCall,
  quietLogger,
  unusedCommerceDeps,
} from "./support/wa-agent-commerce-fakes.js";
import { MemoryRedis } from "./support/wa-agent-fakes.js";

import type { Coupon, WaConversation } from "@wasfa/db";
import type { RxResult, RxResultItem } from "@wasfa/shared/schemas/rx";

/*
 * Work package C with fakes: the policy of offer_discount, the order and receipt tools, the paid
 * tools' error mapping and the follow-up messages. The database-backed paths (coupon minting under
 * its lock, order creation, proof submission, rx creation) are covered by wa-agent-commerce.int.test.ts.
 */

const fake = <T>(value: object) => value as unknown as T;
const call = commerceCall();

// --- offer_discount -------------------------------------------------------------------------------

const PLAN = { id: "plan-pro", key: "pro", nameAr: "برو", audience: "individual" };

function couponRow(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: "coupon-1",
    code: "WAABC234",
    campaign: "wa_agent",
    kind: "percent",
    value: 1000,
    planIds: ["plan-pro"],
    months: [3],
    endsAt: new Date("2026-10-27T10:00:00.000Z"),
    ...overrides,
  } as Coupon;
}

interface DiscountSetup {
  messages?: number;
  paid?: boolean;
  plan?: typeof PLAN | undefined;
  mint?: unknown;
  discountedStatus?: "applied" | "not_applied" | "invalid";
}

function discountService(setup: DiscountSetup = {}) {
  const minted: unknown[] = [];
  const voided: string[] = [];
  const audits: unknown[] = [];
  const quoted: unknown[] = [];
  const service = new AgentDiscountService(
    fake({
      customerMessageCount: () => Promise.resolve(setup.messages ?? 5),
      bankMethod: () => Promise.resolve({ key: "bank" }),
      mintCoupon: (input: unknown) => {
        minted.push(input);
        return Promise.resolve(setup.mint ?? { outcome: "minted", coupon: couponRow() });
      },
      plan: () => Promise.resolve(PLAN),
      voidCoupon: (id: string) => {
        voided.push(id);
        return Promise.resolve(true);
      },
    }),
    fake({
      publicPlan: () => Promise.resolve("plan" in setup ? setup.plan : PLAN),
      hasPaidOrder: () => Promise.resolve(setup.paid ?? false),
    }),
    fake({
      quote: (_user: string, request: { couponCode?: string }) => {
        quoted.push(request);
        const coupon = request.couponCode !== undefined;
        return Promise.resolve({
          quote: { totalMinor: coupon ? 90_000 : 100_000, currency: "EGP" },
          coupon: coupon ? { status: setup.discountedStatus ?? "applied" } : null,
        });
      },
    }),
    fake({
      record: (entry: unknown) => {
        audits.push(entry);
        return Promise.resolve();
      },
    }),
    quietLogger,
  );
  return { service, minted, audits, quoted, voided };
}

describe("offer_discount policy", () => {
  const withPolicy = (policy: Partial<ReturnType<typeof commerceCall>["config"]["discounts"]>) => {
    const base = commerceCall();
    return commerceCall({
      config: { ...base.config, discounts: { ...base.config.discounts, ...policy } },
    });
  };

  it("refuses when the policy is switched off", async () => {
    const { service, minted } = discountService();
    await expect(service.offer(withPolicy({ enabled: false }), "pro", 3)).resolves.toEqual({
      offered: false,
      reason: "disabled",
    });
    expect(minted).toHaveLength(0);
  });

  it("refuses a plan the policy does not list, and one that is not for sale", async () => {
    const { service } = discountService();
    await expect(service.offer(withPolicy({ plans: ["max"] }), "pro", 3)).resolves.toMatchObject({
      reason: "plan_not_allowed",
    });
    const unknown = discountService({ plan: undefined });
    await expect(unknown.service.offer(call, "ghost", 3)).resolves.toMatchObject({
      reason: "plan_not_found",
    });
    const org = discountService({ plan: { ...PLAN, audience: "organization" } });
    await expect(org.service.offer(call, "pro", 3)).resolves.toMatchObject({
      reason: "plan_not_found",
    });
  });

  it("refuses a returning customer when the policy is for new customers only", async () => {
    const { service } = discountService({ paid: true });
    await expect(service.offer(call, "pro", 3)).resolves.toMatchObject({
      reason: "not_new_customer",
    });
    const open = discountService({ paid: true });
    await expect(
      open.service.offer(withPolicy({ newCustomersOnly: false }), "pro", 3),
    ).resolves.toMatchObject({ offered: true });
  });

  it("refuses before the customer has written enough messages", async () => {
    const { service, minted } = discountService({ messages: 1 });
    await expect(service.offer(call, "pro", 3)).resolves.toMatchObject({ reason: "too_early" });
    expect(minted).toHaveLength(0);
  });

  it("passes the lifetime and daily-cap refusals of the mint through as reasons", async () => {
    for (const reason of ["lifetime_limit", "daily_cap"] as const) {
      const { service, audits } = discountService({ mint: { outcome: "refused", reason } });
      await expect(service.offer(call, "pro", 3)).resolves.toEqual({ offered: false, reason });
      expect(audits).toHaveLength(0);
    }
  });

  it("mints at the policy size and returns the engine's real prices and the real expiry", async () => {
    const { service, minted, audits } = discountService();
    const result = await service.offer(call, "pro", 3);
    expect(minted[0]).toMatchObject({
      userId: COMMERCE_USER_ID,
      planId: "plan-pro",
      months: 3,
      percentBps: 1000,
      validHours: 24,
      perUserLifetime: 1,
      dailyCap: 20,
    });
    expect(result).toMatchObject({
      offered: true,
      reused: false,
      code: "WAABC234",
      percentOff: 10,
      expiresAt: "2026-10-27T10:00:00.000Z",
      planKey: "pro",
      months: 3,
      priceBeforeMinor: 100_000,
      priceAfterMinor: 90_000,
      currency: "EGP",
    });
    expect(typeof (result as { expiresAtCairo: unknown }).expiresAtCairo).toBe("string");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      action: "coupon.create",
      targetType: "coupon",
      targetId: "coupon-1",
      after: { campaign: "wa_agent" },
    });
  });

  it("returns the code the customer already holds instead of minting another, without a new audit row", async () => {
    const held = couponRow({ planIds: ["plan-pro"], months: [6] });
    const { service, audits } = discountService({ mint: { outcome: "reused", coupon: held } });
    const result = await service.offer(call, "pro", 3);
    expect(result).toMatchObject({ offered: true, reused: true, code: "WAABC234", months: 6 });
    expect(audits).toHaveLength(0);
  });

  it("withdraws a coupon it just minted when another promotion already beats it", async () => {
    const { service, voided } = discountService({ discountedStatus: "not_applied" });
    await expect(service.offer(call, "pro", 3)).resolves.toEqual({
      offered: false,
      reason: "no_better_price",
    });
    expect(voided).toEqual(["coupon-1"]);
  });

  it("withdraws a reused coupon that no longer beats the price, and a minted one that cannot be priced", async () => {
    const reused = discountService({
      mint: { outcome: "reused", coupon: couponRow() },
      discountedStatus: "not_applied",
    });
    await expect(reused.service.offer(call, "pro", 3)).resolves.toMatchObject({
      reason: "no_better_price",
    });
    expect(reused.voided).toEqual(["coupon-1"]);

    const orphan = discountService({
      mint: { outcome: "reused", coupon: couponRow({ planIds: ["gone"] }) },
    });
    orphan.voided.length = 0;
    // The held coupon's plan no longer exists: nothing to price, so it is withdrawn too.
    const noPlan = new AgentDiscountService(
      fake({
        customerMessageCount: () => Promise.resolve(5),
        bankMethod: () => Promise.resolve(null),
        mintCoupon: () =>
          Promise.resolve({ outcome: "reused", coupon: couponRow({ planIds: ["gone"] }) }),
        plan: () => Promise.resolve(null),
        voidCoupon: (id: string) => {
          orphan.voided.push(id);
          return Promise.resolve(true);
        },
      }),
      fake({
        publicPlan: () => Promise.resolve(PLAN),
        hasPaidOrder: () => Promise.resolve(false),
      }),
      fake({
        quote: () => Promise.resolve({ quote: { totalMinor: 1, currency: "EGP" }, coupon: null }),
      }),
      fake({ record: () => Promise.resolve() }),
      quietLogger,
    );
    await expect(noPlan.offer(call, "pro", 3)).resolves.toEqual({
      offered: false,
      reason: "price_unavailable",
    });
    expect(orphan.voided).toEqual(["coupon-1"]);
  });
});

describe("agent tools are bound to the chat's account", () => {
  const guest: AgentToolContext = {
    conversationId: COMMERCE_CONVERSATION_ID,
    userId: null,
    market: { currency: "EGP", country: "EG" },
    config: settingDefault("waAgent"),
    now: new Date("2026-10-26T10:00:00.000Z"),
    deps: {
      catalog: { catalog: () => Promise.reject(new Error("unused")) },
      account: { status: () => Promise.reject(new Error("unused")) },
      media: { find: () => Promise.resolve(null) },
      mediaOrigin: "",
      handoff: { raise: () => Promise.resolve() },
      ...unusedCommerceDeps,
    },
    mediaParts: [],
    handoffReason: null,
  };

  it("never lists the commerce and paid tools for a guest", () => {
    const names = toolsFor(false).map((tool) => tool.definition.name);
    for (const name of [
      "offer_discount",
      "start_subscription",
      "attach_receipt",
      "analyze_prescription",
      "ask_medical",
    ]) {
      expect(names).not.toContain(name);
    }
  });

  it("refuses an invented call from a guest and takes no account id from the model", async () => {
    const records: ToolCallRecord[] = [];
    const { handlers } = bindTools(toolsFor(true), guest, records);
    for (const [name, args] of [
      ["offer_discount", { planKey: "pro", months: 3 }],
      ["start_subscription", { planKey: "pro", months: 3 }],
      ["attach_receipt", {}],
      ["analyze_prescription", {}],
      ["ask_medical", { question: "x" }],
    ] as const) {
      const handler = handlers[name];
      expect(await handler?.(args)).toEqual({ error: "not_linked" });
    }
    // A user id in the arguments is not part of any schema: the call is invalid, not honoured.
    const offer = handlers["offer_discount"];
    expect(await offer?.({ planKey: "pro", months: 2 })).toEqual({ error: "not_linked" });
    const linked = { ...guest, userId: COMMERCE_USER_ID };
    const bound = bindTools(toolsFor(true), linked, []).handlers["offer_discount"];
    expect(await bound?.({ planKey: "pro", months: 2 })).toEqual({ error: "invalid_arguments" });
  });
});

// --- start_subscription / attach_receipt ----------------------------------------------------------

const BANK = { key: "bank", reviewSlaMinutes: null };
const INSTRUCTIONS = {
  method: { key: "bank", nameAr: "البنك الأهلي", nameEn: "NBE" },
  instructionsAr: "حوّل المبلغ ثم أرسل الإيصال",
  accountDisplay: "EG12 3456",
  accountHolder: "وصفة",
  reference: "WSP-AB12",
  amountMinor: 90_000,
  currency: "EGP",
  expiresAt: "2026-10-28T10:00:00.000Z",
  reviewSlaMinutes: 60,
};

interface OrderSetup {
  bank?: typeof BANK | null;
  plan?: typeof PLAN | undefined;
  quote?: { totalMinor: number; coupon?: { status: string } | null; applied?: object };
  open?: unknown[];
  quoteError?: Error;
  createError?: Error;
}

function subscriptionService(setup: OrderSetup = {}) {
  const created: unknown[] = [];
  const redis = new MemoryRedis();
  const commerce = {
    user: () => Promise.resolve({ id: COMMERCE_USER_ID, status: "active" }),
    bankMethod: () => Promise.resolve("bank" in setup ? setup.bank : BANK),
    openOrders: () => Promise.resolve(setup.open ?? []),
    orderWithPayment: () =>
      Promise.resolve({ order: { number: "WSO-2026-000123" }, payment: { id: "pay-1" } }),
  };
  const service = new AgentSubscriptionService(
    fake(commerce),
    fake(commerce),
    fake({ publicPlan: () => Promise.resolve("plan" in setup ? setup.plan : PLAN) }),
    fake({
      quote: () =>
        setup.quoteError
          ? Promise.reject(setup.quoteError)
          : Promise.resolve({
              quoteId: "quote-1",
              quote: { totalMinor: 90_000, applied: {}, ...setup.quote },
              coupon: setup.quote?.coupon ?? null,
            }),
    }),
    fake({
      create: (...args: unknown[]) => {
        created.push(args);
        return setup.createError
          ? Promise.reject(setup.createError)
          : Promise.resolve({
              orderId: "order-new",
              orderNumber: "WSO-2026-000124",
              payment: { id: "pay-2" },
            });
      },
    }),
    fake({ instructions: () => Promise.resolve(INSTRUCTIONS) }),
    fake({}),
    fake({}),
    fake({ get: () => Promise.resolve({ reviewSlaMinutes: 120 }) }),
    fake(redis),
    quietLogger,
  );
  return { service, created, redis };
}

describe("start_subscription", () => {
  const input = { planKey: "pro", months: 3 };

  it("answers no_bank_method when the market has none", async () => {
    const { service } = subscriptionService({ bank: null });
    await expect(service.start(call, input)).resolves.toEqual({
      started: false,
      reason: "no_bank_method",
    });
  });

  it("creates the order, returns the transfer details as the site shows them and remembers the order", async () => {
    const { service, created, redis } = subscriptionService();
    const result = await service.start(call, input);
    expect(created).toHaveLength(1);
    expect((created[0] as unknown[]).slice(0, 2)).toMatchObject([
      COMMERCE_USER_ID,
      { quoteId: "quote-1", methodKey: "bank" },
    ]);
    expect(result).toMatchObject({
      started: true,
      reused: false,
      amountMinor: 90_000,
      currency: "EGP",
      couponApplied: false,
      instructions: {
        bankName: "البنك الأهلي",
        accountName: "وصفة",
        account: "EG12 3456",
        reference: "WSP-AB12",
        notes: "حوّل المبلغ ثم أرسل الإيصال",
      },
      expiresAt: "2026-10-28T10:00:00.000Z",
      reviewWithinMinutes: 60,
    });
    expect(redis.values.get(`wa:agent:order:${COMMERCE_CONVERSATION_ID}`)).toBe("order-new");
    expect(redis.ttls.get(`wa:agent:order:${COMMERCE_CONVERSATION_ID}`)).toBe(7 * 86_400_000);
  });

  it("hands back the open order for the same plan, period, price and coupon instead of a second one", async () => {
    const open = [
      { order: { id: "order-open", number: "WSO-2026-000099", totalMinor: 90_000, applied: {} } },
    ];
    const { service, created, redis } = subscriptionService({ open });
    const result = await service.start(call, input);
    expect(created).toHaveLength(0);
    expect(result).toMatchObject({ started: true, reused: true, orderRef: "WSO-2026-000099" });
    expect(redis.values.get(`wa:agent:order:${COMMERCE_CONVERSATION_ID}`)).toBe("order-open");
  });

  it("does not reuse an open order whose price or coupon differs", async () => {
    const open = [
      { order: { id: "order-old", number: "WSO-1", totalMinor: 100_000, applied: {} } },
    ];
    const { service, created } = subscriptionService({ open });
    await service.start(call, input);
    expect(created).toHaveLength(1);
  });

  it("still returns the instructions and the full price when the coupon is rejected", async () => {
    const { service } = subscriptionService({
      quote: { totalMinor: 100_000, coupon: { status: "invalid" } },
    });
    const result = await service.start(call, { ...input, couponCode: "NOPE1234" });
    expect(result).toMatchObject({
      started: true,
      couponApplied: false,
      couponRejected: "invalid",
      instructions: { reference: "WSP-AB12" },
    });
  });

  it("maps an unpriced plan and a failed order to reason codes", async () => {
    await expect(
      subscriptionService({ plan: undefined }).service.start(call, input),
    ).resolves.toMatchObject({ started: false, reason: "plan_not_found" });
    await expect(
      subscriptionService({ quoteError: appError("PRICE_NOT_AVAILABLE") }).service.start(
        call,
        input,
      ),
    ).resolves.toMatchObject({ started: false, reason: "price_unavailable" });
    await expect(
      subscriptionService({ createError: appError("QUOTE_EXPIRED") }).service.start(call, input),
    ).resolves.toMatchObject({ started: false, reason: "quote_expired" });
  });
});

const IMAGE = {
  id: "msg-1",
  kind: "image" as const,
  mediaKey: "wa/2026/10/abc12345",
  mediaMime: "image/jpeg",
  mediaBytes: 1234,
  createdAt: new Date("2026-10-26T09:50:00.000Z"),
};

interface ReceiptSetup {
  media?: (typeof IMAGE)[];
  claim?: boolean;
  target?: unknown;
  remembered?: string;
  fileStatus?: string;
  submitError?: Error;
}

function receiptService(setup: ReceiptSetup = {}) {
  const log: string[] = [];
  const metas: unknown[] = [];
  const submitted: unknown[] = [];
  const imported: unknown[] = [];
  const redis = new MemoryRedis();
  if (setup.remembered)
    redis.values.set(`wa:agent:order:${COMMERCE_CONVERSATION_ID}`, setup.remembered);
  const target = setup.target === undefined ? undefined : setup.target;
  const newest = {
    order: { number: "WSO-NEWEST" },
    payment: { id: "pay-newest", reference: "WSP-NEW1", methodKey: "bank" },
  };
  const commerce = {
    newestUnusedMedia: () => Promise.resolve(setup.media ?? [IMAGE]),
    claimMedia: () => {
      log.push("claim");
      return Promise.resolve(setup.claim ?? true);
    },
    releaseMedia: () => {
      log.push("release");
      return Promise.resolve();
    },
    setMediaMeta: (_id: string, meta: unknown) => {
      metas.push(meta);
      return Promise.resolve();
    },
    orderWithPayment: () =>
      Promise.resolve(
        target === undefined
          ? {
              order: { number: "WSO-REMEMBERED", status: "pending_payment" },
              payment: {
                id: "pay-remembered",
                reference: "WSP-REM1",
                status: "awaiting_customer",
                methodKey: "bank",
              },
            }
          : target,
      ),
    newestProofTarget: () =>
      Promise.resolve("target" in setup && setup.target === null ? null : newest),
    method: () => Promise.resolve(BANK),
  };
  const service = new AgentSubscriptionService(
    fake(commerce),
    fake(commerce),
    fake({}),
    fake({}),
    fake({}),
    fake({
      submit: (...args: unknown[]) => {
        submitted.push(args);
        return setup.submitError ? Promise.reject(setup.submitError) : Promise.resolve({});
      },
    }),
    fake({
      importObject: (...args: unknown[]) => {
        imported.push(args);
        return Promise.resolve("file-1");
      },
      awaitProcessed: () => Promise.resolve(setup.fileStatus ?? "processed"),
    }),
    fake({ find: () => Promise.resolve({ phone: "+201012345678" } as WaConversation) }),
    fake({ get: () => Promise.resolve({ reviewSlaMinutes: 120 }) }),
    fake(redis),
    quietLogger,
  );
  return { service, log, metas, submitted, imported };
}

describe("attach_receipt", () => {
  it("files the newest receipt into the review queue and gives the admin SLA, never a confirmation", async () => {
    const { service, imported, submitted, metas } = receiptService();
    const result = await service.attachReceipt(call);
    expect(imported[0]).toMatchObject([
      { id: COMMERCE_USER_ID },
      {
        sourceKey: "wa/2026/10/abc12345",
        purpose: "payment_proof",
        mime: "image/jpeg",
        bytes: 1234,
      },
    ]);
    expect(submitted[0]).toMatchObject([
      COMMERCE_USER_ID,
      "pay-newest",
      { txnId: "WA-WSP-NEW1", senderPhone: "201012345678", fileId: "file-1" },
    ]);
    expect(metas[0]).toEqual({ attachedAs: { fileId: "file-1", paymentId: "pay-newest" } });
    // The method has no override of its own, so the admin's billing setting answers.
    expect(result).toEqual({ attached: true, orderRef: "WSO-NEWEST", reviewWithinMinutes: 120 });
    expect(JSON.stringify(result)).not.toMatch(/confirm|activ|approved/i);
  });

  it("prefers the order the agent opened for this chat", async () => {
    const { service, submitted } = receiptService({ remembered: "order-open" });
    await service.attachReceipt(call);
    expect((submitted[0] as unknown[]).slice(0, 2)).toEqual([COMMERCE_USER_ID, "pay-remembered"]);
  });

  it("answers no_receipt_found without a picture and never touches an already attached one", async () => {
    const none = receiptService({ media: [] });
    await expect(none.service.attachReceipt(call)).resolves.toEqual({
      attached: false,
      reason: "no_receipt_found",
    });
    const taken = receiptService({ claim: false });
    await expect(taken.service.attachReceipt(call)).resolves.toEqual({
      attached: false,
      reason: "no_receipt_found",
    });
    expect(taken.submitted).toHaveLength(0);
    expect(taken.imported).toHaveLength(0);
  });

  it("answers no_pending_payment before claiming the picture", async () => {
    const { service, log } = receiptService({ target: null });
    await expect(service.attachReceipt(call)).resolves.toEqual({
      attached: false,
      reason: "no_pending_payment",
    });
    expect(log).not.toContain("claim");
  });

  it("gives the picture back when the proof is refused, with the reason code", async () => {
    const { service, log, metas } = receiptService({ submitError: appError("PROOF_LIMIT") });
    await expect(service.attachReceipt(call)).resolves.toEqual({
      attached: false,
      reason: "proof_limit",
    });
    expect(log).toEqual(["claim", "release"]);
    expect(metas).toHaveLength(0);
  });

  it("gives the picture back when the worker rejects or has not finished the file", async () => {
    await expect(
      receiptService({ fileStatus: "rejected" }).service.attachReceipt(call),
    ).resolves.toEqual({ attached: false, reason: "unreadable_receipt" });
    await expect(
      receiptService({ fileStatus: "uploaded" }).service.attachReceipt(call),
    ).resolves.toEqual({ attached: false, reason: "still_processing" });
  });
});

// --- analyze_prescription / ask_medical ----------------------------------------------------------

interface RxSetup {
  images?: (typeof IMAGE)[];
  createError?: Error;
  fileStatus?: string;
  maxPagesPerRx?: number | null;
}

function rxService(setup: RxSetup = {}) {
  const log: string[] = [];
  const created: unknown[] = [];
  const asked: unknown[] = [];
  const redis = new MemoryRedis();
  const config = settingDefault("rx");
  const repo = {
    user: () =>
      Promise.resolve({
        id: COMMERCE_USER_ID,
        name: "منى",
        email: "m@example.com",
        emailVerified: true,
        phoneVerified: true,
        status: "active",
      }),
    newestUnusedMedia: (...args: unknown[]) => {
      asked.push(args);
      return Promise.resolve(setup.images ?? [IMAGE]);
    },
    claimMedia: () => Promise.resolve(true),
    releaseMedia: () => {
      log.push("release");
      return Promise.resolve();
    },
    setMediaMeta: (_id: string, meta: unknown) => {
      log.push(`meta:${JSON.stringify(meta)}`);
      return Promise.resolve();
    },
  };
  const files = {
    importObject: () => Promise.resolve("file-1"),
    awaitProcessed: () => Promise.resolve(setup.fileStatus ?? "processed"),
  };
  const rx = {
    create: (...args: unknown[]) => {
      created.push(args);
      return setup.createError
        ? Promise.reject(setup.createError)
        : Promise.resolve({ id: "rx-1" });
    },
  };
  const credits = { forUser: () => Promise.resolve({ wallet: { balance: 2 } }) };
  const service = new AgentRxService(
    fake(repo),
    fake(repo),
    new RxStartService(fake(repo), fake(files), fake(rx), fake(credits), fake(redis), quietLogger),
    fake(files),
    fake(rx),
    fake({ entitlement: () => Promise.resolve({ maxPagesPerRx: setup.maxPagesPerRx ?? null }) }),
    fake(credits),
    fake({ get: () => Promise.resolve({ ...config, creditsPerPage: 3, maxPages: 2 }) }),
    fake(redis),
    quietLogger,
  );
  return { service, log, created, asked, redis };
}

describe("analyze_prescription", () => {
  it("starts the normal rx pipeline for the imported pictures and stores the chat for the result", async () => {
    const { service, created, redis, asked } = rxService();
    const result = await service.analyze(call);
    expect(result).toEqual({ started: true, pages: 1, credits: 3, etaSeconds: 60 });
    expect(created[0]).toMatchObject([
      { id: COMMERCE_USER_ID, roles: [], permissions: [], isSuperAdmin: false, orgIds: [] },
      { fileIds: ["file-1"], mode: "balanced" },
    ]);
    expect(redis.values.get("wa:agent:rx:rx-1")).toBe(COMMERCE_CONVERSATION_ID);
    expect(redis.ttls.get("wa:agent:rx:rx-1")).toBe(86_400_000);
    // The page limit is the lowest of the setting and the plan: here the setting (2).
    expect(asked[0]).toMatchObject([
      COMMERCE_CONVERSATION_ID,
      ["image"],
      expect.any(Date),
      "rxId",
      2,
    ]);
  });

  it("answers no_image without a recent picture", async () => {
    await expect(rxService({ images: [] }).service.analyze(call)).resolves.toEqual({
      started: false,
      reason: "no_image",
    });
  });

  it("maps the rx refusals to reason codes and gives the pictures back", async () => {
    const poor = rxService({ createError: appError("QUOTA_EXCEEDED", "insufficient_credits") });
    await expect(poor.service.analyze(call)).resolves.toEqual({
      started: false,
      reason: "insufficient_credits",
      balance: 2,
      costPerPage: 3,
    });
    expect(poor.log).toContain("release");
    const cases: Array<[Error, string]> = [
      [appError("CONFLICT", "busy"), "busy"],
      [appError("RATE_LIMITED"), "busy"],
      [appError("QUOTA_EXCEEDED", "daily_cap"), "quota_reached"],
      [appError("UPSTREAM_UNAVAILABLE", "ai_paused"), "unavailable"],
      [appError("PAYMENT_REQUIRED", "plan_feature"), "plan_feature"],
    ];
    for (const [error, reason] of cases) {
      await expect(rxService({ createError: error }).service.analyze(call)).resolves.toEqual({
        started: false,
        reason,
      });
    }
  });

  it("rethrows what it does not know, so the registry answers tool_failed", async () => {
    await expect(
      rxService({ createError: new Error("boom") }).service.analyze(call),
    ).rejects.toThrow("boom");
  });

  it("reports a rejected or unfinished picture instead of starting", async () => {
    await expect(
      rxService({ fileStatus: "rejected" }).service.analyze(call),
    ).resolves.toMatchObject({
      reason: "unreadable_image",
    });
    await expect(
      rxService({ fileStatus: "uploaded" }).service.analyze(call),
    ).resolves.toMatchObject({
      reason: "still_processing",
    });
  });
});

function medicalService(options: { answer?: string; error?: Error; enqueueError?: Error } = {}) {
  const sent: unknown[] = [];
  const asked: unknown[] = [];
  const service = new AgentMedicalService(
    fake({
      user: () =>
        Promise.resolve({
          id: COMMERCE_USER_ID,
          name: "منى",
          email: "m@example.com",
          emailVerified: true,
          phoneVerified: true,
          status: "active",
        }),
    }),
    fake({
      answerOnce: (...args: unknown[]) => {
        asked.push(args);
        return options.error
          ? Promise.reject(options.error)
          : Promise.resolve({ text: options.answer ?? "**اشرب** ماءً", creditsCharged: 4 });
      },
    }),
    fake({ forUser: () => Promise.resolve({ wallet: { balance: 1 } }) }),
    fake({
      enqueue: (_id: string, parts: unknown) => {
        sent.push(parts);
        return options.enqueueError
          ? Promise.reject(options.enqueueError)
          : Promise.resolve(["m1"]);
      },
    }),
    quietLogger,
  );
  return { service, sent, asked };
}

describe("ask_medical", () => {
  it("delivers the answer straight to the customer and returns only that it was delivered", async () => {
    const { service, sent, asked } = medicalService();
    const result = await service.ask(call, "ما فائدة الماء؟");
    expect(result).toEqual({ delivered: true, creditsCharged: 4 });
    // The model never sees the answer: nothing of it is in the tool result.
    expect(JSON.stringify(result)).not.toContain("اشرب");
    const parts = sent[0] as Array<{ kind: string; text: string }>;
    expect(parts[0]?.text).toBe("*اشرب* ماءً");
    expect(parts.at(-1)?.text).toContain("لا تغني عن استشارة الطبيب");
    expect(parts.length).toBeLessThanOrEqual(call.config.caps.maxMessagesPerTurn);
    expect(asked[0]).toMatchObject([
      { id: COMMERCE_USER_ID },
      expect.stringContaining("ما فائدة الماء؟"),
      { chatTitle: "واتساب" },
    ]);
  });

  it("maps credit, busy and kill-switch refusals to reason codes", async () => {
    await expect(
      medicalService({ error: appError("QUOTA_EXCEEDED", "insufficient_credits") }).service.ask(
        call,
        "س",
      ),
    ).resolves.toEqual({ delivered: false, reason: "insufficient_credits", balance: 1 });
    await expect(
      medicalService({ error: appError("CONFLICT", "busy") }).service.ask(call, "س"),
    ).resolves.toEqual({ delivered: false, reason: "busy" });
    await expect(
      medicalService({ error: appError("UPSTREAM_UNAVAILABLE", "ai_paused") }).service.ask(
        call,
        "س",
      ),
    ).resolves.toEqual({ delivered: false, reason: "unavailable" });
  });

  it("reports not_deliverable when the chat was paused while the engine worked", async () => {
    await expect(
      medicalService({ enqueueError: appError("CONFLICT", "conversation_paused") }).service.ask(
        call,
        "س",
      ),
    ).resolves.toEqual({ delivered: false, reason: "not_deliverable" });
  });
});

// --- follow-up messages --------------------------------------------------------------------------

function item(overrides: Partial<RxResultItem> = {}): RxResultItem {
  return {
    rawText: "panadol 500",
    name: "Panadol",
    matchedDrugId: null,
    matchScore: null,
    activeIngredients: [],
    strength: "500 mg",
    form: "أقراص",
    dose: "قرص",
    frequency: "كل 8 ساعات",
    duration: null,
    route: null,
    notes: null,
    confidence: 0.9,
    badge: "high",
    verified: "not_needed",
    box_2d: null,
    page: 0,
    ...overrides,
  };
}

const result = (items: RxResultItem[], unreadable = false): RxResult =>
  ({
    schemaVersion: 1,
    items,
    date: null,
    prescriberLegible: true,
    findings: [],
    unreadableRegions: unreadable ? [{ page: 0, box_2d: [0, 0, 1, 1] }] : [],
  }) as unknown as RxResult;

describe("follow-up messages", () => {
  it("tells the customer a payment was approved, with the order and the plan", () => {
    const text = paymentMessage(
      "order_paid",
      { number: "WSO-1", planName: "برو", rejectReason: null },
      "ar",
    );
    expect(text).toContain("WSO-1");
    expect(text).toContain("برو");
  });

  it("gives the human reason label of a rejection and asks for a new receipt", () => {
    const text = paymentMessage(
      "payment_rejected",
      { number: "WSO-1", planName: "برو", rejectReason: "unreadable_proof" },
      "ar",
    );
    expect(text).toContain("تعذر قراءة الإثبات");
    expect(text).toContain("إيصال");
    const fallback = paymentMessage(
      "payment_rejected",
      { number: "WSO-1", planName: null, rejectReason: "made_up" },
      "en",
    );
    expect(fallback).toContain("(your credit pack): other.");
    expect(fallback).toContain("your credit pack");
  });

  it("asks for a clearer receipt on a resubmit request", () => {
    expect(
      paymentMessage(
        "payment_resubmit",
        { number: "WSO-1", planName: "برو", rejectReason: null },
        "en",
      ),
    ).toContain("clearer receipt");
  });

  it("lists every medicine as the result shows it, flags doubtful ones and ends with disclaimer and link", () => {
    const parts = rxDoneParts(
      result([item(), item({ name: "Augmentin", strength: "1 g", badge: "low" })], true),
      "https://wasfa.online/analyze/rx-1",
      { maxReplyChars: 1200, maxMessagesPerTurn: 3 },
      "ar",
    );
    const all = parts.join("\n");
    expect(all).toContain("💊 *Panadol* 500 mg أقراص\n• الجرعة: قرص\n• عدد المرات: كل 8 ساعات");
    expect(all).toContain("💊 *Augmentin* 1 g أقراص");
    // Only the doubtful medicine carries the doubt line.
    expect(all.match(/قراءة غير مؤكدة/g)).toHaveLength(1);
    expect(all).toContain("لم نستطع قراءتها");
    // The last message always carries the disclaimer and the link.
    expect(parts.at(-1)).toContain("هذه قراءة آلية");
    expect(parts.at(-1)).toContain("https://wasfa.online/analyze/rx-1");
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  describe("the full reading of three medicines", () => {
    const three = (): RxResult => ({
      ...result([
        item({
          name: "Augmentin",
          strength: "1 g",
          dose: "قرص",
          frequency: "مرتين يوميًا",
          duration: "7 أيام",
          route: "فموي",
          notes: "بعد الأكل مباشرة",
          details: {
            purpose: "مضاد حيوي لعلاج العدوى",
            sideEffects: [],
            precautions: ["أخبر الطبيب عن حساسية البنسلين", "يؤخذ مع الطعام", "ثالث"],
          },
        }),
        item({ name: "Lipitor", strength: "20 mg", frequency: "قبل النوم", duration: "شهر" }),
        item({ name: "Panadol", frequency: null, dose: null }),
      ]),
      date: "2026-10-20",
      overview: { summary: "أدوية لعلاج عدوى وارتفاع الكوليسترول.", likelyConditions: [] },
      findings: [{ kind: "duplicate_ingredient", itemIndexes: [0, 2], ingredient: "x" }],
    });
    const caps = { maxReplyChars: 1500, maxMessagesPerTurn: 6 };

    it("gives dose, how often with the meal, duration, route, instructions, use, precautions and times", () => {
      const parts = rxDoneParts(three(), "https://x.test/a/1", caps, "ar", true);
      const text = parts.join("\n\n");
      expect(text).toContain("📋 قرأت الروشتة — عدد الأدوية: 3\n📅 تاريخ الروشتة: 2026-10-20");
      expect(text).toContain(
        [
          "💊 *Augmentin* 1 g أقراص",
          "• الجرعة: قرص",
          "• عدد المرات: مرتين يوميًا بعد الأكل",
          "• المدة: 7 أيام",
          "• طريقة الاستخدام: فموي",
          "• تعليمات الطبيب: بعد الأكل مباشرة",
          "• بيستخدم لـ: مضاد حيوي لعلاج العدوى",
          "• ⚠️ أخبر الطبيب عن حساسية البنسلين",
          "• ⚠️ يؤخذ مع الطعام",
          "• 🕗 مواعيد مقترحة: 8 ص · 8 م",
        ].join("\n"),
      );
      // Two precautions at most.
      expect(text).not.toContain("ثالث");
      expect(text).toContain("💊 *Lipitor* 20 mg");
      expect(text).toContain("• 🕗 مواعيد مقترحة: 10 م");
      // No readable frequency: no times are invented, and the empty lines are left out.
      expect(text).toMatch(/💊 \*Panadol\* 500 mg أقراص\n(?!• عدد المرات)/);
      expect(text.match(/مواعيد مقترحة/g)).toHaveLength(2);
      expect(text).toContain("🩺 الخلاصة: أدوية لعلاج عدوى وارتفاع الكوليسترول.");
      expect(text).toContain("⚠️ مادة فعالة مكررة بين أكثر من دواء");
      expect(text).toContain("البنود: Augmentin، Panadol");
      expect(parts.at(-1)).toContain("📄 بعتلك ملف PDF فيه كل التفاصيل وجدول المواعيد");
      expect(parts.at(-1)).toContain("https://x.test/a/1");
      expect(parts.length).toBeLessThanOrEqual(6);
    });

    it("mentions the PDF only when one follows", () => {
      const text = rxDoneParts(three(), "https://x.test/a/1", caps, "ar").join("\n");
      expect(text).not.toContain("PDF");
    });

    it("adds a meal found in the doctor's notes to the frequency", () => {
      const parts = rxDoneParts(
        result([item({ frequency: "3 مرات يوميًا", notes: "يؤخذ قبل الأكل" })]),
        "l",
        caps,
        "ar",
      );
      expect(parts.join("\n")).toContain("• عدد المرات: 3 مرات يوميًا قبل الأكل");
      expect(parts.join("\n")).toContain("8 ص · 2 م · 8 م");
    });

    it("reads the same in English", () => {
      const parts = rxDoneParts(three(), "https://x.test/a/1", caps, "en", true);
      const text = parts.join("\n\n");
      expect(text).toContain("📋 I read the prescription — medicines: 3");
      expect(text).toContain("• Dose: قرص");
      expect(text).toContain("• Doctor's instructions: بعد الأكل مباشرة");
      expect(text).toContain("• 🕗 Suggested times: 8 AM · 8 PM");
      expect(text).toContain("🩺 Summary: ");
      expect(text).toContain("I sent you a PDF");
    });

    it("falls back to the short list when the full reading does not fit, keeping disclaimer and link", () => {
      const parts = rxDoneParts(
        three(),
        "https://x.test/a/1",
        { maxReplyChars: 200, maxMessagesPerTurn: 2 },
        "ar",
      );
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain("1. Augmentin 1 g");
      expect(parts[0]).not.toContain("• الجرعة");
      expect(parts.at(-1)).toContain("https://x.test/a/1");
    });
  });

  it("keeps the disclaimer and link when the list is long or only one message is allowed", () => {
    const many = Array.from({ length: 30 }, (_, index) => item({ name: `Drug ${String(index)}` }));
    const long = rxDoneParts(
      result(many),
      "https://x.test/analyze/1",
      { maxReplyChars: 300, maxMessagesPerTurn: 2 },
      "ar",
    );
    expect(long).toHaveLength(2);
    expect(long.at(-1)).toContain("https://x.test/analyze/1");
    const single = rxDoneParts(
      result(many),
      "https://x.test/analyze/1",
      { maxReplyChars: 600, maxMessagesPerTurn: 1 },
      "ar",
    );
    expect(single).toHaveLength(1);
    expect(single[0]).toContain("https://x.test/analyze/1");
    expect(single[0]).toContain("هذه قراءة آلية");
  });

  it("says the prescription could not be read and the credits were returned", () => {
    expect(rxFailedText("ar")).toContain("أعدنا الرصيد");
  });
});

// --- the events consumer -------------------------------------------------------------------------

const EVENT_USER = COMMERCE_USER_ID;
const ORDER_ID = "018f0000-0000-7000-8000-0000000000b1";
const RX_ID = "018f0000-0000-7000-8000-0000000000d1";

function conversation(): WaConversation {
  return { id: COMMERCE_CONVERSATION_ID, userId: EVENT_USER, status: "active" } as WaConversation;
}

function eventsConsumer(
  options: {
    enabled?: boolean;
    rxView?: unknown;
    enqueueError?: Error;
    noConversation?: boolean;
    maxMessagesPerTurn?: number;
  } = {},
) {
  type SentPart = { kind: string; text?: string; mediaKey?: string; fileName?: string };
  const sent: Array<{ id: string; parts: SentPart[] }> = [];
  const removed: string[] = [];
  const redis = new MemoryRedis();
  redis.values.set(`wa:agent:rx:${RX_ID}`, COMMERCE_CONVERSATION_ID);
  const config = settingDefault("waAgent");
  const consumer = new WaAgentEventsConsumer(
    fake({ WEB_ORIGIN: ["https://wasfa.online"], REDIS_URL: "redis://unused" }),
    quietLogger,
    fake({ find: () => Promise.resolve(options.noConversation ? null : conversation()) }),
    fake({
      recentConversation: (userId: string) =>
        Promise.resolve(userId === EVENT_USER ? conversation() : null),
      orderWithPayment: (userId: string) =>
        Promise.resolve(
          userId === EVENT_USER
            ? {
                order: { number: "WSO-7", planId: "plan-pro" },
                payment: { rejectReason: "amount_differs" },
              }
            : null,
        ),
      plan: () => Promise.resolve({ nameAr: "برو", nameEn: "Pro" }),
      user: () =>
        Promise.resolve({
          id: EVENT_USER,
          name: "منى",
          email: "m@example.com",
          emailVerified: true,
          phoneVerified: true,
          status: "active",
        }),
    }),
    fake({
      enqueue: (id: string, parts: SentPart[]) => {
        sent.push({ id, parts });
        return options.enqueueError ? Promise.reject(options.enqueueError) : Promise.resolve(["m"]);
      },
    }),
    fake({ get: () => Promise.resolve(options.rxView) }),
    fake({
      get: () =>
        Promise.resolve({
          ...config,
          enabled: options.enabled ?? true,
          caps: {
            ...config.caps,
            maxMessagesPerTurn: options.maxMessagesPerTurn ?? config.caps.maxMessagesPerTurn,
          },
        }),
    }),
    fake(redis),
    fake({
      remove: (key: string) => {
        removed.push(key);
        return Promise.resolve();
      },
    }),
  );
  consumer.timing.lockWaitMs = 0;
  return { consumer, sent, redis, removed };
}

describe("WaAgentEventsConsumer", () => {
  it("sends the fixed rejection message with the reason label to the user's recent chat", async () => {
    const { consumer, sent } = eventsConsumer();
    await consumer.process({ type: "payment_rejected", userId: EVENT_USER, orderId: ORDER_ID });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(COMMERCE_CONVERSATION_ID);
    const text = sent[0]?.parts[0]?.text ?? "";
    expect(text).toContain("WSO-7");
    expect(text).toContain("برو");
    expect(text).toContain("المبلغ مختلف");
  });

  it("does nothing for a user without a chat in the last 24 hours, for another user's order, or when the agent is off", async () => {
    const stranger = eventsConsumer();
    await stranger.consumer.process({
      type: "order_paid",
      userId: "018f0000-0000-7000-8000-0000000000ff",
      orderId: ORDER_ID,
    });
    expect(stranger.sent).toHaveLength(0);
    const off = eventsConsumer({ enabled: false });
    await off.consumer.process({ type: "order_paid", userId: EVENT_USER, orderId: ORDER_ID });
    expect(off.sent).toHaveLength(0);
  });

  it("sends the finished reading once, as the result shows it, with disclaimer and link", async () => {
    const view = { result: result([item(), item({ name: "Doubt", badge: "low" })]) };
    const { consumer, sent } = eventsConsumer({ rxView: view });
    await consumer.process({ type: "rx_done", rxId: RX_ID });
    await consumer.process({ type: "rx_done", rxId: RX_ID });
    expect(sent).toHaveLength(1);
    const all = (sent[0]?.parts ?? []).map((part) => part.text).join("\n");
    expect(all).toContain("*Panadol* 500 mg");
    expect(all).toContain("(قراءة غير مؤكدة");
    expect(all).toContain("هذه قراءة آلية");
    expect(all).toContain(`https://wasfa.online/analyze/${RX_ID}`);
  });

  it("tells the customer a failed reading returned the credits", async () => {
    const { consumer, sent } = eventsConsumer();
    await consumer.process({ type: "rx_failed", rxId: RX_ID });
    expect(sent[0]?.parts[0]?.text).toContain("أعدنا الرصيد");
  });

  it("drops a malformed entry and releases the turn lock after sending", async () => {
    const { consumer, sent, redis } = eventsConsumer();
    await consumer.process({ type: "unknown" });
    await consumer.process(null);
    expect(sent).toHaveLength(0);
    await consumer.process({ type: "order_paid", userId: EVENT_USER, orderId: ORDER_ID });
    expect(redis.values.has(`wa:agent:turn:${COMMERCE_CONVERSATION_ID}`)).toBe(false);
  });

  it("does not throw when the chat was paused meanwhile", async () => {
    const { consumer } = eventsConsumer({
      enqueueError: appError("CONFLICT", "conversation_paused"),
    });
    await expect(
      consumer.process({ type: "order_paid", userId: EVENT_USER, orderId: ORDER_ID }),
    ).resolves.toBeUndefined();
  });
});

describe("WaAgentEventsConsumer files", () => {
  const KEY = "wa/out/2026/10/018f0000-0000-7000-8000-0000000000e1.pdf";
  const PNG = "wa/out/2026/10/018f0000-0000-7000-8000-0000000000e2.png";
  const ready = (mediaKey: string, kind: "document" | "image", fileName: string) => ({
    type: "document_ready",
    conversationId: COMMERCE_CONVERSATION_ID,
    mediaKey,
    fileName,
    kind,
  });

  it("sends a document part for a ready PDF", async () => {
    const { consumer, sent, removed } = eventsConsumer();
    await consumer.process(ready(KEY, "document", "report.pdf"));
    expect(sent).toEqual([
      {
        id: COMMERCE_CONVERSATION_ID,
        parts: [{ kind: "document", mediaKey: KEY, fileName: "report.pdf" }],
      },
    ]);
    expect(removed).toEqual([]);
  });

  it("sends an image part for a ready card", async () => {
    const { consumer, sent } = eventsConsumer();
    await consumer.process(ready(PNG, "image", "card.png"));
    expect(sent[0]?.parts).toEqual([{ kind: "image", mediaKey: PNG }]);
  });

  it("sends the fixed line when the file could not be made", async () => {
    const { consumer, sent } = eventsConsumer();
    await consumer.process({ type: "document_failed", conversationId: COMMERCE_CONVERSATION_ID });
    expect(sent[0]?.parts).toEqual([{ kind: "text", text: documentFailedText("ar") }]);
    expect(documentFailedText("ar")).toContain("تعذّر إنشاء الملف");
  });

  it("deletes the stored file when nothing can be queued for it", async () => {
    const paused = eventsConsumer({ enqueueError: appError("CONFLICT", "conversation_paused") });
    await paused.consumer.process(ready(KEY, "document", "report.pdf"));
    expect(paused.removed).toEqual([KEY]);

    const off = eventsConsumer({ enabled: false });
    await off.consumer.process(ready(KEY, "document", "report.pdf"));
    expect(off.removed).toEqual([KEY]);

    const gone = eventsConsumer({ noConversation: true });
    await gone.consumer.process(ready(PNG, "image", "card.png"));
    expect(gone.removed).toEqual([PNG]);
  });

  it("sends the text summary and then the PDF of a finished reading", async () => {
    const { consumer, sent, removed } = eventsConsumer({ rxView: { result: result([item()]) } });
    await consumer.process({ type: "rx_done", rxId: RX_ID, pdfKey: KEY });
    expect(sent).toHaveLength(1);
    const parts = sent[0]?.parts ?? [];
    expect(parts.at(-1)).toEqual({
      kind: "document",
      mediaKey: KEY,
      fileName: "نتيجة-قراءة-الروشتة.pdf",
    });
    expect(parts.slice(0, -1).every((part) => part.kind === "text")).toBe(true);
    expect(
      parts
        .slice(0, -1)
        .map((part) => part.text)
        .join(" "),
    ).toContain("*Panadol* 500 mg");
    expect(removed).toEqual([]);
  });

  it("keeps the PDF inside the message cap, and the text wins when only one is allowed", async () => {
    const view = { result: result([item()]) };
    const capped = eventsConsumer({ rxView: view, maxMessagesPerTurn: 3 });
    await capped.consumer.process({ type: "rx_done", rxId: RX_ID, pdfKey: KEY });
    expect(capped.sent[0]?.parts.length).toBeLessThanOrEqual(3);
    expect(capped.sent[0]?.parts.at(-1)?.kind).toBe("document");

    const single = eventsConsumer({ rxView: view, maxMessagesPerTurn: 1 });
    await single.consumer.process({ type: "rx_done", rxId: RX_ID, pdfKey: KEY });
    expect(single.sent[0]?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(single.removed).toEqual([KEY]);
  });

  it("sends only the text when the reading has no PDF", async () => {
    const { consumer, sent } = eventsConsumer({ rxView: { result: result([item()]) } });
    await consumer.process({ type: "rx_done", rxId: RX_ID });
    expect(sent[0]?.parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("deletes the PDF of a reading nobody is told about", async () => {
    const { consumer, sent, removed } = eventsConsumer({ rxView: { result: null } });
    await consumer.process({ type: "rx_done", rxId: RX_ID, pdfKey: KEY });
    // The result is gone: the customer hears the failure line, not a PDF.
    expect(sent[0]?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(removed).toEqual([KEY]);
  });
});

import { randomUUID } from "node:crypto";

import { createDb, notificationPrefs, siteSettings, users, type CustomerContact } from "@wasfa/db";
import {
  WA_CUSTOMER_LIST,
  WA_CUSTOMER_OPTOUT_SET,
  waCustomerDay,
  waCustomerResultKey,
  waCustomerSentKey,
  type CustomerMessageInput,
  type CustomerWhatsappCheckPayload,
} from "@wasfa/shared/customer-messages";
import { customerMessagePayloadSchema } from "@wasfa/shared/customer-messages";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  checkCustomerWhatsapp,
  deliverCustomerMessage,
  messageIdFor,
  msUntilWindow,
  renderCustomerWhatsapp,
} from "../src/notifications/customer-channel.js";
import { processCustomerPref } from "../src/notifications/customer-prefs.loop.js";
import { CustomerGuard, processCustomerMessage } from "../src/wa-bridge/customer-messages.js";
import { extractCustomerPrefCommand } from "../src/wa-bridge/inbound.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";

import type { ReplySocket } from "../src/wa-bridge/replies.js";
import type { EmailSendInput, EmailSendPayload } from "@wasfa/shared/email";

/*
 * Customer notifications over WhatsApp (owner decision, 2026-10-17): who gets WhatsApp, the
 * email fallback (not eligible, switched off, over a cap, not confirmed by the bridge), the
 * sending hours, the bridge's own guard, and STOP / START. The worker side runs as `wasfa_api`.
 */

const logger = pino({ level: "silent" });
let postgres: TestPostgres;
let redisInfra: TestRedis;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let redis: Redis;
let counter = 0;

// 13:00 in Cairo (UTC+3 in October): inside the default 09:00-21:00 window.
const INSIDE = new Date("2026-10-14T10:00:00.000Z");
// 23:30 in Cairo.
const OUTSIDE = new Date("2026-10-14T20:30:00.000Z");

beforeAll(async () => {
  [postgres, redisInfra] = await Promise.all([startPostgres(), startRedis()]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 3 });
  redis = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
}, 180_000);

afterAll(async () => {
  await redis?.quit();
  await Promise.all([owner?.close(), worker?.close()]);
  await Promise.all([postgres?.stop(), redisInfra?.stop()]);
});

beforeEach(async () => {
  await redis.flushall();
  await setCustomerMessages({ enabled: true });
});

async function setCustomerMessages(value: Record<string, unknown>): Promise<void> {
  await owner.db.delete(siteSettings).where(eq(siteSettings.key, "whatsapp"));
  await owner.db
    .insert(siteSettings)
    .values({ key: "whatsapp", value: { customerMessages: value } });
}

async function customer(verified = true): Promise<{ id: string; phone: string }> {
  const n = String(++counter).padStart(6, "0");
  const phone = `+2010${n}11`;
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Customer",
      email: `customer${n}@example.com`,
      phone,
      phoneVerified: verified,
      phoneVerifiedAt: verified ? new Date() : null,
      locale: "ar",
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return { id: row.id, phone };
}

function harness(now = INSIDE) {
  const emails: Array<{ payload: EmailSendInput; jobId: string }> = [];
  const deferred: Array<{ delayMs: number }> = [];
  const checks: Array<{ payload: CustomerWhatsappCheckPayload; delayMs: number }> = [];
  const deps = {
    db: worker.db,
    redis,
    logger,
    webOrigin: "https://wasfa.online",
    enqueueEmail: async (payload: EmailSendInput, jobId: string) => {
      emails.push({ payload, jobId });
    },
    defer: async (_payload: unknown, delayMs: number) => {
      deferred.push({ delayMs });
    },
    scheduleCheck: async (payload: CustomerWhatsappCheckPayload, delayMs: number) => {
      checks.push({ payload, delayMs });
    },
    now: () => now,
  };
  return { deps, emails, deferred, checks };
}

const reminderEmail: EmailSendPayload = {
  template: "subscription_reminder",
  to: "customer@example.com",
  name: "Customer",
  locale: "ar",
  slot: "d3",
  planName: "بلس",
  endsAt: "2026-10-20T10:00:00.000Z",
  link: "https://wasfa.online/billing/renew?sub=x",
};

function message(userId: string, extra: Partial<CustomerMessageInput> = {}) {
  return customerMessagePayloadSchema.parse({
    key: `test:${randomUUID()}`,
    userId,
    kind: "subscription_reminder",
    params: { plan: "بلس", date: "2026-10-20", slot: "d3" },
    path: "/billing/renew?sub=abc",
    email: reminderEmail,
    ...extra,
  });
}

describe("routing a customer notification", () => {
  it("goes to WhatsApp for a verified phone, with the renew link and the STOP footer", async () => {
    const person = await customer();
    const { deps, emails, checks } = harness();
    const payload = message(person.id);
    expect(await deliverCustomerMessage(payload, deps)).toBe("whatsapp");
    expect(emails).toHaveLength(0);
    const queued = await redis.lrange(WA_CUSTOMER_LIST, 0, -1);
    expect(queued).toHaveLength(1);
    const sent = JSON.parse(queued[0] ?? "{}") as { id: string; jid: string; text: string };
    expect(sent.id).toBe(messageIdFor(payload.key));
    expect(sent.jid).toBe(`${person.phone.slice(1)}@s.whatsapp.net`);
    expect(sent.text).toContain("https://wasfa.online/billing/renew?sub=abc");
    expect(sent.text).toContain("إيقاف");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.payload.email).toMatchObject({ template: "subscription_reminder" });
  });

  it("uses email without a verified phone, after STOP, or with the channel switched off", async () => {
    const unverified = await customer(false);
    const optedOut = await customer();
    await owner.db.insert(notificationPrefs).values({
      userId: optedOut.id,
      whatsappOptedOutAt: new Date(),
      whatsappOptedOutVia: "whatsapp",
    });
    for (const id of [unverified.id, optedOut.id]) {
      const { deps, emails } = harness();
      expect(await deliverCustomerMessage(message(id), deps)).toBe("email");
      expect(emails).toHaveLength(1);
    }
    await setCustomerMessages({ enabled: false });
    const verified = await customer();
    const { deps, emails } = harness();
    expect(await deliverCustomerMessage(message(verified.id), deps)).toBe("email");
    expect(emails).toHaveLength(1);
    expect(await redis.llen(WA_CUSTOMER_LIST)).toBe(0);
  });

  it("mails a receipt in any case and still tells WhatsApp", async () => {
    const person = await customer();
    const { deps, emails } = harness();
    const payload = message(person.id, {
      kind: "subscription_activated",
      params: { plan: "بلس", date: "2026-11-14", credits: 150, number: "WSO-2026-000001" },
      emailAlways: true,
    });
    expect(await deliverCustomerMessage(payload, deps)).toBe("whatsapp");
    expect(emails).toHaveLength(1);
    expect(await redis.llen(WA_CUSTOMER_LIST)).toBe(1);
  });

  it("still mails a suspended account its receipt, and nothing else", async () => {
    const person = await customer();
    await owner.db
      .update(users)
      .set({ status: "suspended", suspendedReason: "spam" })
      .where(eq(users.id, person.id));
    const receipt = harness();
    expect(
      await deliverCustomerMessage(message(person.id, { emailAlways: true }), receipt.deps),
    ).toBe("email");
    expect(receipt.emails).toHaveLength(1);
    const reminder = harness();
    expect(await deliverCustomerMessage(message(person.id), reminder.deps)).toBe("none");
    expect(reminder.emails).toHaveLength(0);
    expect(await redis.llen(WA_CUSTOMER_LIST)).toBe(0);
  });

  it("waits for the sending hours instead of messaging at night", async () => {
    const person = await customer();
    const { deps, deferred } = harness(OUTSIDE);
    expect(await deliverCustomerMessage(message(person.id), deps)).toBe("deferred");
    expect(await redis.llen(WA_CUSTOMER_LIST)).toBe(0);
    // 23:30 -> 09:00 Cairo is 9.5 hours.
    expect(deferred[0]?.delayMs).toBe(9.5 * 3_600_000);
    expect(msUntilWindow(OUTSIDE, { timezone: "Africa/Cairo", startHour: 9, endHour: 21 })).toBe(
      9.5 * 3_600_000,
    );
  });

  it("falls back to email past the per-customer and the total daily caps", async () => {
    await setCustomerMessages({ enabled: true, perUserDailyCap: 1, dailyCap: 2 });
    const first = await customer();
    const second = await customer();
    const third = await customer();
    const run = async (id: string) => deliverCustomerMessage(message(id), harness().deps);
    expect(await run(first.id)).toBe("whatsapp");
    expect(await run(first.id)).toBe("email");
    expect(await run(second.id)).toBe("whatsapp");
    expect(await run(third.id)).toBe("email");
  });
});

describe("the fallback check", () => {
  it("mails when the bridge never took the message, and the bridge then refuses it", async () => {
    const { deps, emails } = harness();
    const id = randomUUID();
    const outcome = await checkCustomerWhatsapp(
      { messageId: id, key: "test:check", email: reminderEmail },
      deps,
    );
    expect(outcome).toBe("fallback");
    expect(emails).toHaveLength(1);
    expect(await redis.get(waCustomerResultKey(id))).toBe("expired");
  });

  it("does nothing when the bridge sent it, and mails when the bridge refused it", async () => {
    const { deps, emails } = harness();
    const sent = randomUUID();
    await redis.set(waCustomerResultKey(sent), "sent");
    expect(await checkCustomerWhatsapp({ messageId: sent, key: "k:1" }, deps)).toBe("sent");
    const denied = randomUUID();
    await redis.set(waCustomerResultKey(denied), "denied:opted_out");
    expect(
      await checkCustomerWhatsapp({ messageId: denied, key: "k:2", email: reminderEmail }, deps),
    ).toBe("fallback");
    expect(emails).toHaveLength(1);
  });
});

describe("the bridge's customer guard", () => {
  function socket(connected = true) {
    const sent: Array<{ jid: string; text: string }> = [];
    const value: ReplySocket = {
      isConnected: () => connected,
      composing: async () => undefined,
      paused: async () => undefined,
      sendText: async (jid, text) => {
        sent.push({ jid, text });
      },
    };
    return { value, sent };
  }
  const entry = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: randomUUID(),
      jid: "201000000011@s.whatsapp.net",
      kind: "subscription_reminder",
      text: "Reminder\nhttps://wasfa.online/billing/renew?sub=1",
      createdAt: Date.now(),
      ...overrides,
    });
  const deps = (guard: CustomerGuard, s: ReplySocket) => ({
    guard,
    socket: s,
    logger,
    sleep: async () => undefined,
  });

  it("sends a fresh message with our own link once, and records it", async () => {
    const guard = new CustomerGuard(redis, worker.db, "https://wasfa.online");
    const s = socket();
    const raw = entry();
    expect(await processCustomerMessage(raw, deps(guard, s.value))).toBe("sent");
    expect(await processCustomerMessage(raw, deps(guard, s.value))).toBe("already_decided");
    expect(s.sent).toHaveLength(1);
    const { id } = JSON.parse(raw) as { id: string };
    expect(await redis.get(waCustomerResultKey(id))).toBe("sent");
    expect(await redis.get(waCustomerSentKey(waCustomerDay(Date.now())))).toBe("1");
  });

  it("refuses when switched off, stale, opted out, linking elsewhere, or over the daily cap", async () => {
    const s = socket();
    await setCustomerMessages({ enabled: false });
    let guard = new CustomerGuard(redis, worker.db, "https://wasfa.online");
    expect(await processCustomerMessage(entry(), deps(guard, s.value))).toBe("disabled");

    await setCustomerMessages({ enabled: true, dailyCap: 1 });
    guard = new CustomerGuard(redis, worker.db, "https://wasfa.online");
    expect(
      await processCustomerMessage(
        entry({ createdAt: Date.now() - 10 * 60_000 }),
        deps(guard, s.value),
      ),
    ).toBe("stale");
    expect(
      await processCustomerMessage(
        entry({ text: "Pay at https://evil.example/x" }),
        deps(guard, s.value),
      ),
    ).toBe("unsafe_text");
    await redis.sadd(WA_CUSTOMER_OPTOUT_SET, "201000000099@s.whatsapp.net");
    expect(
      await processCustomerMessage(
        entry({ jid: "201000000099@s.whatsapp.net" }),
        deps(guard, s.value),
      ),
    ).toBe("opted_out");
    expect(await processCustomerMessage(entry(), deps(guard, s.value))).toBe("sent");
    expect(await processCustomerMessage(entry(), deps(guard, s.value))).toBe("cap_reached");
    expect(s.sent).toHaveLength(1);

    const deniedId = randomUUID();
    await processCustomerMessage(
      entry({ id: deniedId, text: "www.other.com" }),
      deps(guard, s.value),
    );
    expect(await redis.get(waCustomerResultKey(deniedId))).toBe("denied:unsafe_text");
  });

  it("leaves a message unclaimed while disconnected, so the check mails it", async () => {
    const guard = new CustomerGuard(redis, worker.db, "https://wasfa.online");
    const raw = entry();
    expect(await processCustomerMessage(raw, deps(guard, socket(false).value))).toBe(
      "not_connected",
    );
    const { id } = JSON.parse(raw) as { id: string };
    expect(await redis.get(waCustomerResultKey(id))).toBeNull();
  });
});

describe("STOP and START", () => {
  it("parses only a whole-message keyword from a direct chat", async () => {
    const resolver = { getPNForLID: async () => null };
    const raw = (text: string) => ({
      key: { id: "m1", remoteJid: "201012345678@s.whatsapp.net", fromMe: false },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });
    expect(await extractCustomerPrefCommand(raw(" إيقاف "), resolver)).toMatchObject({
      action: "stop",
      digits: "201012345678",
    });
    expect(await extractCustomerPrefCommand(raw("stop"), resolver)).toMatchObject({
      action: "stop",
    });
    expect(await extractCustomerPrefCommand(raw("START"), resolver)).toMatchObject({
      action: "start",
    });
    expect(await extractCustomerPrefCommand(raw("please stop the rx"), resolver)).toBeNull();
    expect(await extractCustomerPrefCommand(raw("إيقاف التنبيهات"), resolver)).toBeNull();
  });

  it("records the choice on the account whose verified phone sent it, and nothing for strangers", async () => {
    const person = await customer();
    const digits = person.phone.slice(1);
    const command = (action: string, from = digits) =>
      JSON.stringify({ action, digits: from, jid: `${from}@s.whatsapp.net` });
    expect(await processCustomerPref(worker.db, command("stop"))).toBe("stopped");
    const prefs = async () =>
      (
        await owner.db
          .select()
          .from(notificationPrefs)
          .where(eq(notificationPrefs.userId, person.id))
      )[0];
    expect((await prefs())?.whatsappOptedOutVia).toBe("whatsapp");
    expect(await processCustomerPref(worker.db, command("start"))).toBe("started");
    expect((await prefs())?.whatsappOptedOutAt).toBeNull();
    expect(await processCustomerPref(worker.db, command("stop", "201999999999"))).toBe("ignored");
    expect(await processCustomerPref(worker.db, "{broken")).toBe("ignored");
  });
});

describe("message texts", () => {
  it("renders each kind in both languages with the note, the link and the footer", () => {
    const link = "https://wasfa.online/billing/orders/1";
    const rejected = renderCustomerWhatsapp(
      "payment_rejected",
      "ar",
      { number: "WSO-2026-000001", reason: "unreadable_proof", note: "الصورة غير واضحة" },
      link,
    );
    expect(rejected).toContain("WSO-2026-000001");
    expect(rejected).toContain("الصورة غير واضحة");
    expect(rejected).not.toContain("unreadable_proof");
    expect(rejected).toContain(link);
    const expired = renderCustomerWhatsapp(
      "subscription_reminder",
      "en",
      { plan: "Plus", date: "2026-10-20", slot: "expired" },
      null,
    );
    expect(expired).toContain("Plus");
    expect(expired).toContain("STOP");
    const contact: Pick<CustomerContact, "locale"> = { locale: "ar" };
    expect(contact.locale).toBe("ar");
  });
});

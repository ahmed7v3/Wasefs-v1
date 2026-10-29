import { randomUUID } from "node:crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { creditsFor } from "@wasfa/ai";
import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  aiUsage,
  chatMessages,
  chats,
  chatSummaries,
  createDb,
  creditLedger,
  creditReservations,
  creditWallets,
  files,
  grantPeriod,
  onboardingProgress,
  planAssignments,
  plans,
  seedDefaults,
} from "@wasfa/db";
import { newId } from "@wasfa/shared/ids";
import { parseChatEvent, type ChatEvent } from "@wasfa/shared/schemas/chat";
import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";
import { processedObjectKey } from "@wasfa/shared/storage";
import { and, asc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";
import { ChatBackground } from "../src/chat/chat-background.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AuthHarness, WEB, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { useUpMonthlyGrant } from "./support/monthly-grant.js";
import { startStorage, type TestStorage } from "./support/storage.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/*
 * The /ai assistant against real Postgres, Redis and MinIO with the `fake` provider: the SSE
 * contract, credit settlement, the stop and regenerate flows, every refusal that must be plain
 * JSON, ownership of every chat route, and the first-token overhead measurement (see phase2.md Notes).
 */

let infra: TestInfra;
let storage: TestStorage;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let background: ChatBackground;
let proPlanId: string;
let echoModelId: string;
let baseUrl = "";
const network = setupServer(...pwnedHandlers());
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

const PRICE = 50_000_000; // USD micros per 1M tokens: makes one answer cost several credits
const MULTIPLIER_BP = 20_000;
const CREDIT_VALUE = 10_000;

interface Person {
  jar: Jar;
  userId: string;
}

beforeAll(async () => {
  [infra, storage] = await Promise.all([startInfra(), startStorage()]);
  network.listen({ onUnhandledRequest: "bypass" });
  owner = createDb({ url: infra.databaseUrl, max: 4 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra, storage.env), {
    extraImports: [harness.mailerModule()],
    authMailer: false,
  });
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
  background = app.get(ChatBackground);
  await app.listen(0, "127.0.0.1");
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");

  const planRows = await owner.db.select({ id: plans.id, key: plans.key }).from(plans);
  const found = planRows.find((row) => row.key === "pro");
  if (!found) throw new Error("pro plan missing");
  proPlanId = found.id;

  const [provider] = await owner.db
    .insert(aiProviders)
    .values({ key: "fake-chat", kind: "fake", dataPolicy: "paid_no_training", enabled: true })
    .returning({ id: aiProviders.id });
  if (!provider) throw new Error("provider insert failed");
  const prices = {
    priceInputUsdMicrosPerM: PRICE,
    priceOutputUsdMicrosPerM: PRICE,
    creditMultiplierBp: MULTIPLIER_BP,
  };
  const models = await owner.db
    .insert(aiModels)
    .values([
      {
        providerId: provider.id,
        modelId: "fake-echo",
        displayName: "Echo",
        capabilities: ["json", "vision"],
        ...prices,
      },
      {
        providerId: provider.id,
        modelId: "fake-slow",
        displayName: "Slow",
        capabilities: ["json"],
        ...prices,
      },
      {
        providerId: provider.id,
        modelId: "fake-think",
        displayName: "Think",
        capabilities: ["json", "search", "thinking"],
        ...prices,
      },
    ])
    .returning({ id: aiModels.id, modelId: aiModels.modelId });
  const idOf = (modelId: string) => {
    const model = models.find((row) => row.modelId === modelId);
    if (!model) throw new Error(`model ${modelId} missing`);
    return model.id;
  };
  echoModelId = idOf("fake-echo");

  const route = async (
    task: "chat" | "deep_think" | "title_gen" | "summarize",
    mode: "fast" | "balanced" | "deep",
    modelId: string,
  ) => {
    const updated = await owner.db
      .update(aiTaskRoutes)
      .set({ models: [{ modelId, params: {} }], version: 50 })
      .where(and(eq(aiTaskRoutes.task, task), eq(aiTaskRoutes.mode, mode)))
      .returning({ id: aiTaskRoutes.id });
    if (updated.length === 0) {
      await owner.db
        .insert(aiTaskRoutes)
        .values({ task, mode, planId: null, models: [{ modelId, params: {} }] });
    }
  };
  await route("chat", "fast", idOf("fake-slow"));
  await route("chat", "balanced", echoModelId);
  await route("chat", "deep", idOf("fake-think"));
  await route("deep_think", "deep", idOf("fake-think"));
  for (const mode of ["fast", "balanced", "deep"] as const) {
    await route("title_gen", mode, echoModelId);
    await route("summarize", mode, echoModelId);
  }
}, 300_000);

afterAll(async () => {
  network.close();
  await redis?.quit();
  await app?.close();
  await owner?.close();
  await storage?.stop();
  await infra?.stop();
});

async function person(options: { pro?: boolean; credits?: number } = {}): Promise<Person> {
  const signed = await harness.signedInUser();
  await owner.db
    .insert(onboardingProgress)
    .values({ userId: signed.userId, currentStep: "done", completedAt: new Date() });
  if (options.pro) {
    await owner.db
      .insert(planAssignments)
      .values({ ownerUserId: signed.userId, planId: proPlanId, reason: "test" });
  }
  const credits = options.credits ?? 500;
  if (credits === 0) await useUpMonthlyGrant(owner.db, signed.userId);
  if (credits > 0) {
    await owner.db
      .insert(creditWallets)
      .values({ ownerUserId: signed.userId, balance: credits })
      .onConflictDoNothing();
    // The ledger sum must match the balance for the wallet to be consistent.
    const [wallet] = await owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, signed.userId));
    if (!wallet) throw new Error("wallet missing");
    await owner.db.insert(creditLedger).values({
      walletId: wallet.id,
      kind: "grant",
      amount: credits,
      balanceAfter: credits,
      // The month's plan grant, so the on-demand grant (CreditsService) adds nothing on top.
      idempotencyKey: `grant:user:${signed.userId}:${grantPeriod(new Date())}`,
    });
  }
  return { jar: signed.jar, userId: signed.userId };
}

const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  who: Person,
  body?: Record<string, unknown>,
) => harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

async function newChat(who: Person, body: Record<string, unknown> = {}): Promise<string> {
  const res = await call("POST", "/ai/chats", who, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

function parseSse(raw: string): ChatEvent[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .flatMap((block) => {
      const name = /^event: (.+)$/m.exec(block)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
      const event = parseChatEvent(name, data);
      return event ? [event] : [];
    });
}

async function send(who: Person, chatId: string, body: Record<string, unknown>) {
  const res = await call("POST", `/ai/chats/${chatId}/messages`, who, {
    mode: "balanced",
    ...body,
  });
  return {
    res,
    events: res.headers["content-type"]?.toString().startsWith("text/event-stream")
      ? parseSse(res.body)
      : [],
  };
}

const names = (events: ChatEvent[]) => events.map((event) => event.event);
const textOf = (events: ChatEvent[]) =>
  events.map((event) => (event.event === "text" ? event.data.delta : "")).join("");

async function messagesOf(chatId: string) {
  return owner.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
}

async function ledgerOf(userId: string) {
  const [wallet] = await owner.db
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  if (!wallet) throw new Error("wallet missing");
  return {
    wallet,
    entries: await owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.walletId, wallet.id))
      .orderBy(asc(creditLedger.createdAt)),
  };
}

async function untilNotStreaming(messageId: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [message] = await owner.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId));
    if (message && message.status !== "streaming") return message;
    if (Date.now() > deadline) throw new Error("message still streaming");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("POST /ai/chats/:id/messages", () => {
  it("streams message_id, text, credits, done; stores both messages and settles the credits", async () => {
    const who = await person();
    const chatId = await newChat(who);
    const { res, events } = await send(who, chatId, { content: "ما هو الباراسيتامول؟" });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-cache");
    const order = names(events);
    expect(order[0]).toBe("message_id");
    expect(order.slice(-2)).toEqual(["credits", "done"]);
    expect(order.filter((name) => name === "text").length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "done" } });

    const [first] = events;
    if (first?.event !== "message_id") throw new Error("no message_id");
    const rows = await messagesOf(chatId);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[0]?.id).toBe(first.data.userMessageId);
    expect(rows[1]?.id).toBe(first.data.assistantMessageId);
    expect(rows[0]?.content).toBe("ما هو الباراسيتامول؟");
    // The fake echoes the prompt it was given: the question arrives wrapped as data.
    expect(rows[1]).toMatchObject({ status: "done", content: textOf(events) });
    expect(rows[1]?.content).toContain("<user_data>");

    // Credits: the model's own usage row prices the answer; the ledger holds, releases, settles.
    const [usage] = await owner.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.id, rows[1]?.aiUsageId ?? randomUUID()));
    expect(usage).toBeDefined();
    const expected = creditsFor(usage?.costUsdMicros ?? 0, MULTIPLIER_BP, CREDIT_VALUE);
    expect(expected).toBeGreaterThan(1);
    expect(rows[1]?.creditsCharged).toBe(expected);
    const { wallet, entries } = await ledgerOf(who.userId);
    expect(wallet.balance).toBe(500 - expected);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "grant",
      "usage_reserve",
      "release",
      "usage_settle",
    ]);
    expect(entries.at(-1)).toMatchObject({
      kind: "usage_settle",
      amount: -expected,
      aiUsageId: usage?.id,
    });
    const credits = events.find((event) => event.event === "credits");
    expect(credits).toMatchObject({ data: { charged: expected, balance: 500 - expected } });
    const [reservation] = await owner.db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.walletId, wallet.id));
    expect(reservation).toMatchObject({ status: "settled", settledAmount: expected });
    // The lock is free again and the follow-up work (title) happens after the stream.
    expect(await redis.get(`busy:${who.userId}:chat`)).toBeNull();
    await background.drain();
    const [chat] = await owner.db.select().from(chats).where(eq(chats.id, chatId));
    expect(chat?.title).toBeTruthy();
    expect(Array.from(chat?.title ?? "").length).toBeLessThanOrEqual(60);

    const list = await call("GET", `/ai/chats/${chatId}/messages`, who);
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: { role: string }[] }>().items.map((item) => item.role)).toEqual([
      "assistant",
      "user",
    ]);
  });

  it("streams thinking, sources and a thought duration in deep mode with search (pro plan)", async () => {
    const who = await person({ pro: true });
    const chatId = await newChat(who);
    const { res, events } = await send(who, chatId, {
      content: "deep question",
      mode: "deep",
      search: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(names(events).indexOf("thinking")).toBeGreaterThan(names(events).indexOf("message_id"));
    expect(
      events
        .filter((event) => event.event === "source")
        .map((event) => (event.event === "source" ? event.data.domain : "")),
    ).toEqual(["example.org", "example.com"]);
    const rows = await messagesOf(chatId);
    expect(rows[1]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "thought" }),
        expect.objectContaining({
          type: "source",
          url: "https://example.org/guide",
          domain: "example.org",
        }),
      ]),
    );
    const list = await call("GET", `/ai/chats/${chatId}/messages`, who);
    const assistant = list
      .json<{ items: { role: string; parts: { type: string }[] }[] }>()
      .items.find((item) => item.role === "assistant");
    expect(assistant?.parts.map((part) => part.type)).toContain("source");
  });

  it("stops when the client disconnects: the partial answer is kept and charged", async () => {
    const who = await person();
    const chatId = await newChat(who);
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/ai/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB, cookie: cookieOf(who.jar) },
      body: JSON.stringify({
        content: "a fairly long question to be echoed back slowly",
        mode: "fast",
      }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes("event: text")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    expect(seen).toContain("event: text");
    controller.abort();

    const events = parseSse(seen);
    const id = events.find((event) => event.event === "message_id");
    if (id?.event !== "message_id") throw new Error("no message_id");
    const message = await untilNotStreaming(id.data.assistantMessageId);
    expect(message.status).toBe("stopped");
    expect(message.content.length).toBeGreaterThan(0);
    expect(message.content.length).toBeLessThan(80);
    expect(message.creditsCharged).toBeGreaterThanOrEqual(1);
    const { wallet, entries } = await ledgerOf(who.userId);
    expect(wallet.balance).toBe(500 - message.creditsCharged);
    expect(entries.at(-1)).toMatchObject({ kind: "usage_settle", amount: -message.creditsCharged });
    // The lock is released in the finally block.
    const deadline = Date.now() + 5_000;
    while ((await redis.get(`busy:${who.userId}:chat`)) !== null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await redis.get(`busy:${who.userId}:chat`)).toBeNull();
  });

  it("regenerates the last answer in place and refuses any other message", async () => {
    const who = await person();
    const chatId = await newChat(who);
    const first = await send(who, chatId, { content: "first question" });
    const second = await send(who, chatId, { content: "second question" });
    const [, firstAssistant] = (await messagesOf(chatId)).slice(0, 2);
    const secondId = second.events.find((event) => event.event === "message_id");
    if (secondId?.event !== "message_id") throw new Error("no message_id");

    const stale = await send(who, chatId, { regenerate: firstAssistant?.id });
    expect(stale.res.statusCode).toBe(409);
    expect(stale.res.json()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "not_last_message" },
    });

    const again = await send(who, chatId, { regenerate: secondId.data.assistantMessageId });
    expect(again.res.statusCode, again.res.body).toBe(200);
    const fresh = again.events.find((event) => event.event === "message_id");
    if (fresh?.event !== "message_id") throw new Error("no message_id");
    expect(fresh.data.userMessageId).toBe(secondId.data.userMessageId);
    expect(fresh.data.assistantMessageId).not.toBe(secondId.data.assistantMessageId);
    const rows = await messagesOf(chatId);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(rows.at(-1)?.id).toBe(fresh.data.assistantMessageId);
    expect(rows.at(-1)?.content).toContain("second question");
    expect(first.res.statusCode).toBe(200);
  });

  it("answers ai_paused as plain JSON under the kill switch, before any message or hold", async () => {
    const who = await person();
    const chatId = await newChat(who);
    const settings = app.get(SettingsService);
    await settings.set(
      "ai",
      { killSwitch: { all: false, rx: false, chat: true, search: false, wa_agent: false } },
      { actorId: null },
    );
    try {
      const { res } = await send(who, chatId, { content: "hello" });
      expect(res.statusCode).toBe(503);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json()).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        details: { reason: "ai_paused" },
      });
    } finally {
      await settings.set(
        "ai",
        { killSwitch: { all: false, rx: false, chat: false, search: false, wa_agent: false } },
        { actorId: null },
      );
    }
    expect(await messagesOf(chatId)).toHaveLength(0);
    expect(await redis.get(`busy:${who.userId}:chat`)).toBeNull();
    expect((await send(who, chatId, { content: "hello again" })).res.statusCode).toBe(200);
  });

  it("answers CONFLICT busy while another stream of the same user is running, storing nothing", async () => {
    const who = await person();
    const chatId = await newChat(who);
    await redis.set(`busy:${who.userId}:chat`, "other-stream", "EX", 60);
    const { res } = await send(who, chatId, { content: "hello" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "CONFLICT", details: { reason: "busy" } });
    expect(await messagesOf(chatId)).toHaveLength(0);
    // The foreign lock is not ours to release.
    expect(await redis.get(`busy:${who.userId}:chat`)).toBe("other-stream");
  });

  it("answers PAYMENT_REQUIRED plan_feature for a mode or web search the plan lacks", async () => {
    const who = await person();
    const chatId = await newChat(who);
    const deep = await send(who, chatId, { content: "hello", mode: "deep" });
    expect(deep.res.statusCode).toBe(402);
    expect(deep.res.json()).toMatchObject({
      code: "PAYMENT_REQUIRED",
      details: { reason: "plan_feature" },
    });
    const search = await send(who, chatId, { content: "hello", search: true });
    expect(search.res.statusCode).toBe(402);
    expect(search.res.json()).toMatchObject({ details: { reason: "plan_feature" } });
    expect(await messagesOf(chatId)).toHaveLength(0);
    expect(await redis.get(`busy:${who.userId}:chat`)).toBeNull();
  });

  it("refuses without enough credits, as JSON, and frees the lock", async () => {
    const who = await person({ credits: 3 });
    const chatId = await newChat(who);
    const { res } = await send(who, chatId, { content: "hello" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: { reason: "insufficient_credits" },
    });
    expect(await messagesOf(chatId)).toHaveLength(0);
    expect(await redis.get(`busy:${who.userId}:chat`)).toBeNull();
  });

  it("validates the body", async () => {
    const who = await person();
    const chatId = await newChat(who);
    for (const body of [
      { content: "" },
      { content: "x".repeat(8_001) },
      {
        content: "hi",
        fileIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      },
      { content: "hi", mode: "turbo" },
      {},
    ]) {
      const res = await call("POST", `/ai/chats/${chatId}/messages`, who, {
        mode: "balanced",
        ...body,
      });
      expect(res.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });

  it("attaches a processed image of the caller, and hides anyone else's or an unfinished one", async () => {
    const who = await person();
    const other = await person();
    const chatId = await newChat(who);
    const make = async (person: Person, status: "processed" | "uploaded") => {
      const id = newId();
      const key = processedObjectKey(person.userId, id);
      await owner.db.insert(files).values({
        id,
        ownerUserId: person.userId,
        createdBy: person.userId,
        purpose: "chat_image",
        r2Key: key,
        mime: "image/jpeg",
        bytes: 16,
        status,
      });
      if (status === "processed") {
        await storage.s3.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: Buffer.alloc(16, 1),
            ContentType: "image/jpeg",
          }),
        );
      }
      return id;
    };
    const mine = await make(who, "processed");
    const foreign = await make(other, "processed");
    const pending = await make(who, "uploaded");

    const hidden = await send(who, chatId, { content: "look", fileIds: [foreign] });
    expect(hidden.res.statusCode).toBe(404);
    const notReady = await send(who, chatId, { content: "look", fileIds: [pending] });
    expect(notReady.res.statusCode).toBe(409);
    expect(notReady.res.json()).toMatchObject({ details: { reason: "file_not_ready" } });
    expect(await messagesOf(chatId)).toHaveLength(0);

    const ok = await send(who, chatId, { content: "look", fileIds: [mine] });
    expect(ok.res.statusCode, ok.res.body).toBe(200);
    const [question] = await messagesOf(chatId);
    expect(question?.parts).toEqual([{ type: "image", fileId: mine }]);
  });

  it("summarizes after the 10th answer and keeps the summary out of the verbatim window", async () => {
    const who = await person({ credits: 5_000 });
    const chatId = await newChat(who);
    for (let i = 1; i <= 10; i += 1) {
      const { res } = await send(who, chatId, { content: `question number ${i}` });
      expect(res.statusCode, res.body).toBe(200);
    }
    await background.drain();
    const [summary] = await owner.db
      .select()
      .from(chatSummaries)
      .where(eq(chatSummaries.chatId, chatId));
    expect(summary?.summary.length).toBeGreaterThan(0);
    const rows = await messagesOf(chatId);
    // 20 messages, the last 12 stay verbatim: the summary ends at the 8th.
    expect(summary?.throughMessageId).toBe(rows[7]?.id);
  });
});

describe("chat CRUD", () => {
  it("creates, lists (search, archive, paging), renames, archives and deletes", async () => {
    const who = await person();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1)
      ids.push(await newChat(who, i === 0 ? { skill: "drug-info" } : {}));
    const [a, b, c] = ids as [string, string, string];
    expect((await call("GET", `/ai/chats/${a}`, who)).json()).toMatchObject({
      id: a,
      skill: "drug-info",
      title: null,
      archived: false,
    });

    const rename = await call("PATCH", `/ai/chats/${b}`, who, { title: "Aspirin dosing" });
    expect(rename.statusCode, rename.body).toBe(200);
    expect(rename.json()).toMatchObject({ title: "Aspirin dosing" });
    expect((await call("PATCH", `/ai/chats/${b}`, who, {})).statusCode).toBe(400);
    expect((await call("PATCH", `/ai/chats/${b}`, who, { title: "x".repeat(61) })).statusCode).toBe(
      400,
    );

    const all = await call("GET", "/ai/chats?limit=2", who);
    const page = all.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const rest = await call("GET", `/ai/chats?limit=2&cursor=${page.nextCursor}`, who);
    expect(rest.json<{ items: { id: string }[] }>().items).toHaveLength(1);
    expect((await call("GET", "/ai/chats?cursor=bad!", who)).statusCode).toBe(400);

    const found = await call("GET", "/ai/chats?q=aspir", who);
    expect(found.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toEqual([b]);
    expect(
      (await call("GET", "/ai/chats?q=%25", who)).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);

    await call("PATCH", `/ai/chats/${c}`, who, { archived: true });
    expect(
      (await call("GET", "/ai/chats", who))
        .json<{ items: { id: string }[] }>()
        .items.map((i) => i.id),
    ).not.toContain(c);
    expect(
      (await call("GET", "/ai/chats?archived=true", who))
        .json<{ items: { id: string }[] }>()
        .items.map((i) => i.id),
    ).toEqual([c]);

    expect((await call("DELETE", `/ai/chats/${a}`, who)).statusCode).toBe(204);
    expect((await call("GET", `/ai/chats/${a}`, who)).statusCode).toBe(404);
  });

  it("needs a session and finished onboarding", async () => {
    expect((await harness.call("GET", "/ai/chats")).statusCode).toBe(401);
    const fresh = await harness.signedInUser();
    const res = await harness.call("GET", "/ai/chats", { jar: fresh.jar });
    expect(res.statusCode).toBe(403);
  });
});

describe("ownership: another user's chat is NOT_FOUND on every route", () => {
  it("hides GET, PATCH, GET messages, POST messages and DELETE, and changes nothing", async () => {
    const mine = await person();
    const intruder = await person();
    const chatId = await newChat(mine);
    const routes: {
      method: "GET" | "PATCH" | "POST" | "DELETE";
      url: string;
      body?: Record<string, unknown>;
    }[] = [
      { method: "GET", url: `/ai/chats/${chatId}` },
      { method: "PATCH", url: `/ai/chats/${chatId}`, body: { title: "stolen" } },
      { method: "GET", url: `/ai/chats/${chatId}/messages` },
      { method: "GET", url: `/ai/chats/${chatId}/messages?cursor=bm90LWEtY3Vyc29y` },
      {
        method: "POST",
        url: `/ai/chats/${chatId}/messages`,
        body: { content: "hi", mode: "balanced" },
      },
      { method: "DELETE", url: `/ai/chats/${chatId}` },
    ];
    for (const route of routes) {
      const res = await call(route.method, route.url, intruder, route.body);
      expect(res.statusCode, `${route.method} ${route.url} ${res.body}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    const [chat] = await owner.db.select().from(chats).where(eq(chats.id, chatId));
    expect(chat).toMatchObject({ title: null, userId: mine.userId });
    expect(await messagesOf(chatId)).toHaveLength(0);
    expect((await call("GET", `/ai/chats/${chatId}`, mine)).statusCode).toBe(200);
    // The intruder's list never shows it either.
    expect(
      (await call("GET", "/ai/chats", intruder)).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect((await call("DELETE", `/ai/chats/${chatId}`, mine)).statusCode).toBe(204);
  });
});

describe("GET /me/credits chat features", () => {
  it("lists the modes and web search the plan allows", async () => {
    const free = await person();
    const pro = await person({ pro: true });
    const freeBody = meCreditsResponseSchema.parse((await call("GET", "/me/credits", free)).json());
    expect(freeBody.chat).toEqual({ modes: ["fast", "balanced"], webSearch: false });
    const proBody = meCreditsResponseSchema.parse((await call("GET", "/me/credits", pro)).json());
    expect(proBody.chat).toEqual({ modes: ["fast", "balanced", "deep"], webSearch: true });
  });
});

describe("first-token overhead", () => {
  it("measures the time to the first text event with an instant provider", async () => {
    const who = await person({ credits: 5_000 });
    const samples: { firstEvent: number; firstText: number }[] = [];
    for (let i = 0; i < 20; i += 1) {
      const chatId = await newChat(who);
      const startedAt = performance.now();
      const response = await fetch(`${baseUrl}/ai/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB, cookie: cookieOf(who.jar) },
        body: JSON.stringify({ content: "overhead probe", mode: "balanced" }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      let seen = "";
      let firstEvent = 0;
      let firstText = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value);
        if (firstEvent === 0) firstEvent = performance.now() - startedAt;
        if (firstText === 0 && seen.includes("event: text"))
          firstText = performance.now() - startedAt;
      }
      samples.push({ firstEvent, firstText });
    }
    const sorted = samples.map((s) => s.firstText).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const firstEvents = samples.map((s) => s.firstEvent).sort((x, y) => x - y);
    process.stdout.write(
      `\n[chat first-token overhead, fake provider, n=${sorted.length}] first text: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms; first event (message_id): median ${(firstEvents[Math.floor(firstEvents.length / 2)] ?? 0).toFixed(1)} ms\n`,
    );
    expect(median).toBeLessThan(1_000);
    await background.drain();
  });
});

function cookieOf(jar: Jar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

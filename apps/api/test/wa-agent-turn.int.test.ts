import { randomUUID } from "node:crypto";

import { AiProviderError, scriptQueue, type FakeScript } from "@wasfa/ai";
import { adminAlerts, users, waConversations, waMessages } from "@wasfa/db";
import { t } from "@wasfa/shared/i18n";
import { WA_AGENT_OUT_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentPauseKey, type WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ObjectStorage } from "../src/files/object-storage.js";
import { PlansService } from "../src/plans/plans.service.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { WaAgentHandoffService } from "../src/wa-agent/agent/handoff.service.js";
import { WaAgentToolDeps } from "../src/wa-agent/agent/tool-deps.js";
import { WaAgentTurnService } from "../src/wa-agent/agent/wa-agent-turn.service.js";
import { WaAgentRepo } from "../src/wa-agent/wa-agent.repo.js";
import { WaOutboundService } from "../src/wa-agent/wa-outbound.service.js";

import { AdminTestContext } from "./support/admin-context.js";
import { fakeAi, silentLogger } from "./support/wa-agent-fakes.js";

/*
 * The WhatsApp agent's turn against the real database and Redis: the model is the scripted fake, but
 * the transcript, the account facts, the outbound queue, the pause and the owner alert are real.
 */

const MEDIA_ORIGIN = "https://media.test";
const ctx = new AdminTestContext();
let repo: WaAgentRepo;
let settings: SettingsService;
let outbound: WaOutboundService;
let handoff: WaAgentHandoffService;

beforeAll(async () => {
  await ctx.start([], { MEDIA_PUBLIC_ORIGIN: MEDIA_ORIGIN });
  repo = ctx.app.get(WaAgentRepo);
  settings = ctx.app.get(SettingsService);
  outbound = ctx.app.get(WaOutboundService);
  handoff = ctx.app.get(WaAgentHandoffService);
  handoff.timing.pollMs = 5;
  handoff.timing.sleep = (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const today = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");

beforeEach(async () => {
  await settings.set(
    "waAgent",
    { enabled: true, guestsEnabled: true, spendCapUsdMicros: 5_000_000 },
    { actorId: null },
  );
  await ctx.redis.del(`wa:agent:spend:${today()}`);
});

let counter = 0;
function phone(): string {
  counter += 1;
  return `+2010${String(70_000_000 + counter * 7)}`;
}

/** Stores a customer message the way the stream consumer does (without starting a turn). */
async function receive(number: string, text: string, jid?: string) {
  const digits = number.slice(1);
  const entry: WaAgentInbound = {
    waMessageId: randomUUID(),
    jid: jid ?? `${digits}@s.whatsapp.net`,
    phone: number,
    direction: "in",
    kind: "text",
    text,
    ts: Date.now(),
  };
  return (await repo.ingest(entry, new Date(Date.now() + 60_000))).conversation;
}

async function createUser(
  number: string,
  status: "active" | "suspended" = "active",
): Promise<string> {
  const [row] = await ctx.owner.db
    .insert(users)
    .values({
      name: "Mona Ali",
      email: `${randomUUID()}@example.com`,
      phone: number,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      status,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user not created");
  return row.id;
}

function turnsWith(
  script: FakeScript,
  options: { costUsdMicros?: number; unavailable?: Error } = {},
) {
  const ai = fakeAi(script, options);
  const service = new WaAgentTurnService(
    repo,
    settings,
    ctx.redis,
    ai.service,
    outbound,
    handoff,
    ctx.app.get(WaAgentToolDeps),
    ctx.app.get(PlansService),
    ctx.app.get(ObjectStorage),
    silentLogger,
  );
  // No waiting for the quiet period: the rows are already there.
  service.timing.quietMs = 0;
  service.timing.maxQuietWaitMs = 0;
  return { service, ai };
}

const toolCall = (name: string, args: unknown = {}) => ({
  text: "",
  toolCalls: [{ id: `call-${name}`, name, arguments: args }],
});

async function messagesOf(conversationId: string) {
  return ctx.owner.db
    .select()
    .from(waMessages)
    .where(eq(waMessages.conversationId, conversationId))
    .orderBy(asc(waMessages.createdAt), asc(waMessages.id));
}

const outRows = async (conversationId: string) =>
  (await messagesOf(conversationId)).filter((row) => row.direction === "out");

describe("a guest", () => {
  it("is answered, and the reply rows keep the record of the turn without arguments", async () => {
    const conversation = await receive(phone(), "كام سعر الباقات؟");
    const { service, ai } = turnsWith(
      scriptQueue([toolCall("get_catalog"), "الباقات من *199* جنيه\n\nتحب أساعدك تختار؟"]),
      { costUsdMicros: 25 },
    );
    const before = await ctx.redis.xlen(WA_AGENT_OUT_STREAM);
    await service.onInbound(conversation.id);

    expect(ai.inputs[0]).toMatchObject({ task: "wa_agent", mode: "balanced", planId: null });
    expect(ai.adapter.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      "get_catalog",
      "send_media",
      "handoff_to_owner",
    ]);
    const rows = await outRows(conversation.id);
    expect(rows.map((row) => [row.status, row.text])).toEqual([
      ["queued", "الباقات من *199* جنيه"],
      ["queued", "تحب أساعدك تختار؟"],
    ]);
    for (const row of rows) {
      expect(row.meta).toMatchObject({
        tools: [{ name: "get_catalog", ok: true }],
        steps: 2,
        costUsdMicros: 50,
        truncated: false,
      });
      expect(JSON.stringify(row.meta)).not.toContain("arguments");
    }
    expect(await ctx.redis.xlen(WA_AGENT_OUT_STREAM)).toBe(before + 1);
    // The customer's message is marked taken, so a second pass does not answer it again.
    const calls = ai.inputs.length;
    await service.onInbound(conversation.id);
    expect(ai.inputs).toHaveLength(calls);
  });

  it("is not answered when guests are switched off", async () => {
    await settings.set("waAgent", { enabled: true, guestsEnabled: false }, { actorId: null });
    const conversation = await receive(phone(), "hello");
    const { service, ai } = turnsWith(scriptQueue(["hi"]));
    await service.onInbound(conversation.id);
    expect(ai.inputs).toHaveLength(0);
    expect(await outRows(conversation.id)).toHaveLength(0);
  });

  it("gets one turn for a burst of messages", async () => {
    const number = phone();
    await receive(number, "one");
    await receive(number, "two");
    const conversation = await receive(number, "three");
    const { service, ai } = turnsWith(scriptQueue(["تمام"]));
    await Promise.all([1, 2, 3].map(() => service.onInbound(conversation.id)));
    expect(ai.inputs).toHaveLength(1);
    expect(await outRows(conversation.id)).toHaveLength(1);
    const taken = (await messagesOf(conversation.id)).filter((row) => row.direction === "in");
    expect(new Set(taken.map((row) => (row.meta as { turn?: string }).turn)).size).toBe(1);
    expect(taken.every((row) => typeof (row.meta as { turn?: string }).turn === "string")).toBe(
      true,
    );
  });
});

describe("a linked customer", () => {
  it("is answered from the real account facts of the chat's own account", async () => {
    const number = phone();
    const userId = await createUser(number);
    const conversation = await receive(number, "رصيدي كام؟");
    expect(conversation.userId).toBe(userId);
    const { service, ai } = turnsWith(
      scriptQueue([toolCall("account_status", { userId: randomUUID() }), "رصيدك ظاهر"]),
    );
    await service.onInbound(conversation.id);

    expect(ai.adapter.requests[0]?.tools?.map((tool) => tool.name)).toContain("account_status");
    expect(ai.inputs[0]?.userId).toBe(userId);
    const toolMessage = ai.adapter.requests[1]?.messages.at(-1);
    const facts = JSON.parse(toolMessage?.role === "tool" ? toolMessage.content : "{}") as {
      plan?: { key?: string };
      credits?: { balance?: number };
      pendingOrders?: unknown[];
    };
    expect(typeof facts.plan?.key).toBe("string");
    expect(facts.credits?.balance).toBe(0);
    expect(facts.pendingOrders).toEqual([]);
  });

  it("gets one polite line per day when the account is suspended, and no AI", async () => {
    const number = phone();
    await createUser(number, "suspended");
    const conversation = await receive(number, "hello");
    const { service, ai } = turnsWith(scriptQueue(["hi"]));
    await service.onInbound(conversation.id);
    await receive(number, "hello again");
    await service.onInbound(conversation.id);
    expect(ai.inputs).toHaveLength(0);
    const rows = await outRows(conversation.id);
    expect(rows.map((row) => row.text)).toEqual([t("whatsapp.agent.accountUnavailable")]);
  });
});

describe("handoff", () => {
  it("alerts the owner without phone or text and pauses once the reply was delivered", async () => {
    const number = phone();
    const conversation = await receive(number, "customer-secret-text");
    const reason = "العميل عايز يكلم المالك";
    const { service } = turnsWith(
      scriptQueue([toolCall("handoff_to_owner", { reason }), "المالك هيرد عليك قريب"]),
    );
    await service.onInbound(conversation.id);

    const rows = await outRows(conversation.id);
    expect(rows.map((row) => row.text)).toEqual(["المالك هيرد عليك قريب"]);
    // Not paused yet: the bridge would drop the very reply that explains the handoff.
    expect(
      (
        await ctx.owner.db
          .select()
          .from(waConversations)
          .where(eq(waConversations.id, conversation.id))
      )[0]?.status,
    ).toBe("active");

    const alerts = await ctx.owner.db
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.refId, conversation.id));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.summary).toContain(reason);
    expect(alerts[0]?.summary).not.toContain(number);
    expect(alerts[0]?.summary).not.toContain("customer-secret-text");

    // The bridge reports the reply as sent; the pause follows.
    await ctx.owner.db
      .update(waMessages)
      .set({ status: "sent" })
      .where(eq(waMessages.conversationId, conversation.id));
    await handoff.drain();
    const [after] = await ctx.owner.db
      .select()
      .from(waConversations)
      .where(eq(waConversations.id, conversation.id));
    expect(after?.status).toBe("paused");
    expect(after?.pausedUntil?.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(await ctx.redis.exists(waAgentPauseKey(conversation.jid))).toBe(1);
  });
});

describe("spend cap and failures", () => {
  it("at the daily cap: one busy line, an owner alert, a pause, and no model call", async () => {
    await settings.set(
      "waAgent",
      { enabled: true, guestsEnabled: true, spendCapUsdMicros: 1_000 },
      { actorId: null },
    );
    await ctx.redis.set(`wa:agent:spend:${today()}`, "1000");
    const conversation = await receive(phone(), "hello");
    const { service, ai } = turnsWith(scriptQueue(["never sent"]));
    await service.onInbound(conversation.id);

    expect(ai.inputs).toHaveLength(0);
    expect((await outRows(conversation.id)).map((row) => row.text)).toEqual([
      t("whatsapp.agent.busy"),
    ]);
    expect(
      await ctx.owner.db.select().from(adminAlerts).where(eq(adminAlerts.refId, conversation.id)),
    ).toHaveLength(1);
    await ctx.owner.db
      .update(waMessages)
      .set({ status: "sent" })
      .where(eq(waMessages.conversationId, conversation.id));
    await handoff.drain();
    const [after] = await ctx.owner.db
      .select()
      .from(waConversations)
      .where(eq(waConversations.id, conversation.id));
    expect(after?.status).toBe("paused");
  });

  it("a model error shows the customer only the busy line, and the cost spent so far is booked", async () => {
    const conversation = await receive(phone(), "hello");
    const { service } = turnsWith(
      scriptQueue([toolCall("get_catalog"), new AiProviderError("unavailable")]),
      { costUsdMicros: 300 },
    );
    await service.onInbound(conversation.id);
    expect((await outRows(conversation.id)).map((row) => row.text)).toEqual([
      t("whatsapp.agent.busy"),
    ]);
    expect(Number(await ctx.redis.get(`wa:agent:spend:${today()}`))).toBeGreaterThanOrEqual(300);
    await handoff.drain();
  });
});

describe("outbound media parts", () => {
  async function conversationId(): Promise<string> {
    return (await receive(phone(), "hi")).id;
  }

  it("accepts an image under the media origin and refuses any other address", async () => {
    const id = await conversationId();
    const [queued] = await outbound.enqueue(id, [
      { kind: "image", url: `${MEDIA_ORIGIN}/media/abc/1200.jpeg`, caption: "حسابنا" },
    ]);
    const row = (await messagesOf(id)).find((message) => message.id === queued);
    expect(row).toMatchObject({ kind: "image", text: "حسابنا", mediaKey: null, status: "queued" });

    for (const url of [
      "https://evil.example.net/a.jpeg",
      `${MEDIA_ORIGIN}.evil.net/a.jpeg`,
      `${MEDIA_ORIGIN}/../a.jpeg`,
    ]) {
      await expect(outbound.enqueue(id, [{ kind: "image", url }])).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    await expect(
      outbound.enqueue(id, [
        { kind: "image", mediaKey: "wa/2026/10/abcdefgh", url: `${MEDIA_ORIGIN}/a.jpeg` },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

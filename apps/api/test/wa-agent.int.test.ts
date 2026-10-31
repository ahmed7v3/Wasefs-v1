import { randomUUID } from "node:crypto";

import { users, waConversations, waMessages } from "@wasfa/db";
import { WA_AGENT_OUT_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentPauseKey, type WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SettingsService } from "../src/settings/settings.service.js";
import { WaAgentInboundConsumer } from "../src/wa-agent/transport/inbound.consumer.js";
import { WaOutboundService } from "../src/wa-agent/transport/outbound.service.js";
import { WaAgentSentConsumer } from "../src/wa-agent/transport/sent.consumer.js";

import { AdminTestContext } from "./support/admin-context.js";

/*
 * The WhatsApp agent's transport and data layer: what the inbound consumer stores, who a chat is
 * linked to (verified phones only), the owner's takeover pause (row and Redis mirror), and what the
 * outbound service refuses. The bridge side is covered by the worker's unit tests.
 */

const ctx = new AdminTestContext();
let inbound: WaAgentInboundConsumer;
let sent: WaAgentSentConsumer;
let outbound: WaOutboundService;
let settings: SettingsService;

beforeAll(async () => {
  await ctx.start();
  inbound = ctx.app.get(WaAgentInboundConsumer);
  sent = ctx.app.get(WaAgentSentConsumer);
  outbound = ctx.app.get(WaOutboundService);
  settings = ctx.app.get(SettingsService);
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await settings.set("waAgent", { enabled: true }, { actorId: null });
});

let counter = 0;
function phone(): string {
  counter += 1;
  return `+2010${String(60_000_000 + counter * 7)}`;
}

function entry(overrides: Partial<WaAgentInbound> & { phone: string | null }): WaAgentInbound {
  const digits = overrides.phone?.slice(1) ?? String(900_000_000 + counter++);
  return {
    waMessageId: randomUUID(),
    jid: overrides.phone === null ? `${digits}@lid` : `${digits}@s.whatsapp.net`,
    direction: "in",
    kind: "text",
    text: "hello",
    ts: Date.now(),
    ...overrides,
  };
}

async function createUser(number: string, verified: boolean): Promise<string> {
  const [row] = await ctx.owner.db
    .insert(users)
    .values({
      name: "Customer",
      email: `${randomUUID()}@example.com`,
      phone: number,
      ...(verified ? { phoneVerified: true, phoneVerifiedAt: new Date() } : {}),
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user not created");
  return row.id;
}

async function conversationOf(jid: string) {
  const [row] = await ctx.owner.db
    .select()
    .from(waConversations)
    .where(eq(waConversations.jid, jid));
  return row;
}

describe("inbound consumer", () => {
  it("stores the message, creates the conversation and sets last_inbound_at", async () => {
    const message = entry({ phone: phone(), pushName: "Mona" });
    await inbound.process(message);
    const conversation = await conversationOf(message.jid);
    expect(conversation).toMatchObject({ phone: message.phone, status: "active", userId: null });
    expect(conversation?.lastInboundAt).not.toBeNull();
    const rows = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.waMessageId, message.waMessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "in",
      kind: "text",
      text: "hello",
      status: "received",
    });
  });

  it("stores a redelivered entry once and ignores malformed ones", async () => {
    const message = entry({ phone: phone() });
    await inbound.process(message);
    await inbound.process(message);
    await inbound.process({ nonsense: true });
    const rows = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.waMessageId, message.waMessageId));
    expect(rows).toHaveLength(1);
  });

  it("links a chat to an account only through a VERIFIED phone, re-resolved on every message", async () => {
    const verifiedNumber = phone();
    const unverifiedNumber = phone();
    const verifiedId = await createUser(verifiedNumber, true);
    await createUser(unverifiedNumber, false);

    const linked = entry({ phone: verifiedNumber });
    await inbound.process(linked);
    expect((await conversationOf(linked.jid))?.userId).toBe(verifiedId);

    const guest = entry({ phone: unverifiedNumber });
    await inbound.process(guest);
    expect((await conversationOf(guest.jid))?.userId).toBeNull();

    // The account verifies later: the next message links the same chat.
    await ctx.owner.db
      .update(users)
      .set({ phoneVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.phone, unverifiedNumber));
    await inbound.process(entry({ phone: unverifiedNumber, jid: guest.jid }));
    expect((await conversationOf(guest.jid))?.userId).not.toBeNull();

    // An unresolved LID is a guest and keeps its LID jid.
    const lid = entry({ phone: null });
    await inbound.process(lid);
    expect(await conversationOf(lid.jid)).toMatchObject({ phone: null, userId: null });
  });

  it("pauses the chat when the owner types, in the row and in Redis", async () => {
    const number = phone();
    const message = entry({ phone: number, direction: "owner", text: "I will handle this" });
    await inbound.process(message);
    const conversation = await conversationOf(message.jid);
    expect(conversation?.status).toBe("paused");
    const minutes = (await settings.get("waAgent")).takeoverPauseMinutes;
    const remaining = (conversation?.pausedUntil?.getTime() ?? 0) - Date.now();
    expect(remaining).toBeGreaterThan((minutes - 1) * 60_000);
    expect(remaining).toBeLessThanOrEqual(minutes * 60_000);
    expect(await ctx.redis.exists(waAgentPauseKey(message.jid))).toBe(1);
    expect(await ctx.redis.pttl(waAgentPauseKey(message.jid))).toBeGreaterThan(0);
    const [row] = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.waMessageId, message.waMessageId));
    expect(row).toMatchObject({ direction: "owner", status: "sent" });
  });
});

describe("outbound service", () => {
  async function conversation(): Promise<{ id: string; jid: string }> {
    const message = entry({ phone: phone() });
    await inbound.process(message);
    const row = await conversationOf(message.jid);
    if (!row) throw new Error("no conversation");
    return { id: row.id, jid: row.jid };
  }

  it("queues rows and an entry for the bridge, and records the bridge's verdicts", async () => {
    const { id, jid } = await conversation();
    const before = await ctx.redis.xlen(WA_AGENT_OUT_STREAM);
    const ids = await outbound.enqueue(id, [
      { kind: "text", text: "hi" },
      { kind: "text", text: "there" },
    ]);
    expect(ids).toHaveLength(2);
    expect(await ctx.redis.xlen(WA_AGENT_OUT_STREAM)).toBe(before + 1);
    const queued = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.conversationId, id));
    // The inbound message also started a turn, which queued its own busy line (no model is configured
    // here), so only the two rows enqueued above are checked.
    expect(queued.filter((row) => ids.includes(row.id)).map((row) => row.status)).toEqual([
      "queued",
      "queued",
    ]);

    await sent.process({ messageId: ids[0], status: "sent", waMessageId: "WA-OUT-1" });
    await sent.process({ messageId: ids[1], status: "dropped", reason: "cap_chat_hour" });
    await sent.process({ messageId: ids[1], status: "sent", waMessageId: "WA-OUT-2" });
    const after = await ctx.owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.conversationId, id));
    const byId = new Map(after.map((row) => [row.id, row]));
    expect(byId.get(ids[0] ?? "")).toMatchObject({ status: "sent", waMessageId: "WA-OUT-1" });
    // A replayed or contradicting verdict does not change a decided row.
    expect(byId.get(ids[1] ?? "")).toMatchObject({
      status: "dropped",
      dropReason: "cap_chat_hour",
    });
    expect((await conversationOf(jid))?.lastOutboundAt).not.toBeNull();
  });

  it("refuses while the chat is paused after the owner took over", async () => {
    const message = entry({ phone: phone() });
    await inbound.process(message);
    await inbound.process(entry({ phone: message.phone, jid: message.jid, direction: "owner" }));
    const row = await conversationOf(message.jid);
    await expect(
      outbound.enqueue(row?.id ?? "", [{ kind: "text", text: "hi" }]),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "conversation_paused" },
    });
  });

  it("refuses when the agent is off, the chat is blocked, or the parts break the caps", async () => {
    const { id } = await conversation();
    await settings.set("waAgent", { enabled: false }, { actorId: null });
    await expect(outbound.enqueue(id, [{ kind: "text", text: "hi" }])).rejects.toMatchObject({
      details: { reason: "agent_disabled" },
    });
    await settings.set("waAgent", { enabled: true }, { actorId: null });

    await expect(outbound.enqueue(id, [])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      outbound.enqueue(id, [{ kind: "text", text: "x".repeat(1_201) }]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      outbound.enqueue(
        id,
        Array.from({ length: 4 }, () => ({ kind: "text", text: "a" })),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await ctx.owner.db
      .update(waConversations)
      .set({ status: "blocked" })
      .where(eq(waConversations.id, id));
    await expect(outbound.enqueue(id, [{ kind: "text", text: "hi" }])).rejects.toMatchObject({
      details: { reason: "conversation_blocked" },
    });
  });
});

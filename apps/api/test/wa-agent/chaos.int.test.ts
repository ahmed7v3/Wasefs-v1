import { randomUUID } from "node:crypto";

import { AiProviderError } from "@wasfa/ai";
import { creditReservations, creditWallets, waOutbox, waTurns } from "@wasfa/db";
import { settingDefault } from "@wasfa/shared/settings";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { REDIS } from "../../src/common/redis.js";
import { ConversationLock } from "../../src/wa-agent/turn/lock.js";
import { AdminTestContext } from "../support/admin-context.js";

import { TINY_JPEG } from "./scenarios/fixtures.js";
import { Scenario, V2Runtime } from "./scenarios/harness.js";

import type { AgentRound } from "../../src/wa-agent/turn/agent-round.js";
import type { RunResult } from "../../src/wa-agent/turn/turn-runner.js";
import type { Redis } from "ioredis";

/*
 * Chaos for WP1 (docs/WA-AGENT-RUNTIME.md section 17): Redis drops in the middle of a turn or of a
 * delivery, and a paid result arrives during an owner's pause after the turn that started it failed.
 * Whatever happens, the customer gets each answer once and never none.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const toolCall = (name: string, args: unknown = {}) => ({
  text: "",
  toolCalls: [{ id: `call-${name}`, name, arguments: args }],
});
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
const noQueue = { enqueue: () => Promise.resolve() };
const v2Settings = () => ({ runtime: { ...settingDefault("waAgent").runtime, v2: true } });

const replied = async (scenario: Scenario) =>
  (
    await ctx.owner.db
      .select()
      .from(waTurns)
      .where(eq(waTurns.conversationId, scenario.conversationId))
  ).filter((turn) => turn.state === "replied");

/**
 * A round that runs `outage` once, inside the first model call, then thinks as usual. This is where a
 * real outage bites: the model call is the long part of a turn, and the lock's heartbeat is the only
 * thing that talks to Redis meanwhile (the lock client is the harness' `ctx.redis`, a different client
 * from the app's, so breaking it leaves the database and the outbound queue alone).
 */
function roundWithOutage(
  scenario: Scenario,
  outage: (signal: AbortSignal) => Promise<void>,
): AgentRound {
  let first = true;
  return {
    compose: async (conversation, pending, signal, options) => {
      if (first) {
        first = false;
        await outage(signal);
      }
      return scenario.round.compose(conversation, pending, signal, options);
    },
    afterReply: (id, messageIds, outcome) => scenario.round.afterReply(id, messageIds, outcome),
    discard: (outcome) => scenario.round.discard(outcome),
  };
}

// Short lock timing so an outage longer than the lock's life fits in a test.
const TTL_MS = 400;
const HEARTBEAT_MS = 50;
const shortLock = () =>
  new ConversationLock(ctx.redis, { ttlMs: TTL_MS, heartbeatMs: HEARTBEAT_MS });

/** Every `EVAL` of the lock client (extend, release) fails for longer than the lock lives. */
function redisOutage(): { restore: () => void } {
  const down = vi.spyOn(ctx.redis, "eval").mockRejectedValue(new Error("redis down"));
  return { restore: () => down.mockRestore() };
}

describe("A1 Redis drops while the model works", () => {
  it("the lock is lost and another job answers: one reply, the first job sends nothing", async () => {
    const v2 = new V2Runtime();
    const scenario = await Scenario.start(ctx, {
      model: () => "تمام",
      settings: v2Settings(),
    });
    await scenario.inbound({ text: "عايز أعرف الأسعار" });

    let aborted = false;
    let second: RunResult | undefined;
    const round = roundWithOutage(scenario, async (signal) => {
      const outage = redisOutage();
      // Longer than the lock's life: the heartbeat gives up (lock not renewed) and the key expires.
      await sleep(TTL_MS + 300);
      aborted = signal.aborted;
      outage.restore();
      // Redis is back, the key is gone: another worker takes the conversation and answers.
      second = await v2.runner(scenario).run(scenario.conversationId);
    });
    const first = await scenario.services
      .makeRunner(round, noQueue, shortLock())
      .run(scenario.conversationId);

    expect(aborted, "the heartbeat did not abort the turn when the lock could not be renewed").toBe(
      true,
    );
    expect(second).toBe("answered");
    expect(first).toBe("stale");
    expect(await scenario.outboundTexts()).toEqual(["تمام"]);
    expect(await replied(scenario)).toHaveLength(1);
    expect((await scenario.inboundRows()).every((row) => row.turnId !== null)).toBe(true);

    // Nothing is left to do: another job changes nothing.
    expect(await v2.runner(scenario).run(scenario.conversationId)).toBe("idle");
    expect(await scenario.outboundTexts()).toHaveLength(1);
  });

  it("nobody takes over: the customer is answered once, by the turn or by its re-run, never twice", async () => {
    const v2 = new V2Runtime();
    const scenario = await Scenario.start(ctx, {
      model: () => "تمام",
      settings: v2Settings(),
    });
    await scenario.inbound({ text: "سؤال" });

    const round = roundWithOutage(scenario, async () => {
      const outage = redisOutage();
      await sleep(TTL_MS + 300);
      outage.restore();
    });
    await scenario.services.makeRunner(round, noQueue, shortLock()).run(scenario.conversationId);
    // Whatever the first job did (sent under its still-valid fence, or stepped aside), at most one reply.
    expect((await scenario.outboundTexts()).length).toBeLessThanOrEqual(1);

    // Redis is back: the re-run (the queue's retry) closes whatever the first job left open.
    await v2.runner(scenario).run(scenario.conversationId);
    expect(await scenario.outboundTexts()).toEqual(["تمام"]);
    expect(await replied(scenario)).toHaveLength(1);
    expect((await scenario.inboundRows()).every((row) => row.turnId !== null)).toBe(true);
  });
});

describe("A2 Redis drops while the outbox publishes", () => {
  it("the XADD fails: nothing is sent, the item retries and is delivered once when Redis returns", async () => {
    const scenario = await Scenario.start(ctx, {
      model: () => "تمام",
      settings: v2Settings(),
    });
    await scenario.inbound({ text: "مرحبا" });
    const key = `chaos:${randomUUID()}`;
    const [row] = await ctx.owner.db
      .insert(waOutbox)
      .values({
        conversationId: scenario.conversationId,
        kind: "document",
        idempotencyKey: key,
        payload: { type: "document_failed", conversationId: scenario.conversationId },
        state: "ready",
        paidWork: true,
      })
      .returning();
    if (!row) throw new Error("row not inserted");
    const reload = async () => {
      const [after] = await ctx.owner.db.select().from(waOutbox).where(eq(waOutbox.id, row.id));
      if (!after) throw new Error("row vanished");
      return after;
    };

    // The app's own Redis client is the one that publishes (`ctx.redis` is the test's).
    const appRedis = ctx.app.get<Redis>(REDIS);
    vi.spyOn(appRedis, "xadd").mockRejectedValueOnce(new Error("redis down"));
    const deliverer = scenario.services.deliverer();
    await deliverer.sweep();

    const failed = await reload();
    expect(failed.state).toBe("ready");
    expect(failed.attempts).toBe(1);
    expect(await scenario.outbound()).toHaveLength(0);
    expect(await appRedis.exists(`wa:agent:outbox:published:${key}`)).toBe(0);

    // Redis is back and the backoff has passed.
    await ctx.owner.db
      .update(waOutbox)
      .set({ nextAttemptAt: sql`now()` })
      .where(eq(waOutbox.id, row.id));
    await deliverer.sweep();
    expect((await reload()).state).toBe("delivered");
    expect(await scenario.outboundTexts()).toHaveLength(1);
    expect(await appRedis.exists(`wa:agent:outbox:published:${key}`)).toBe(1);

    // A further pass (or a duplicate claim) sends nothing more.
    await deliverer.sweep();
    expect(await scenario.outboundTexts()).toHaveLength(1);
  });
});

describe("B a paid reading whose turn failed still reaches the customer during an owner pause", () => {
  it("delivers the result text and the PDF once, and holds ordinary replies", async () => {
    const scenario = await Scenario.start(ctx, {
      linked: true,
      runtime: new V2Runtime(),
      model: (_request, call) =>
        [toolCall("analyze_prescription"), new AiProviderError("unavailable")][call] ?? "تمام",
    });
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();

    // The provider failed after the analysis started: the customer got the fallback text.
    expect(scenario.modelInputs()).toHaveLength(2);
    const afterTurn = await scenario.outboundTexts();
    expect(afterTurn).toHaveLength(1);
    const [rxId] = await scenario.readings();
    expect(rxId, "the analysis should have started").toBeDefined();

    // The owner steps in before the worker finishes; then the worker's result arrives with its PDF.
    await scenario.ownerPause();
    const pdfKey = `wa/out/2026/10/${randomUUID()}.pdf`;
    await scenario.workerEvent({ type: "rx_done", rxId: rxId ?? "", pdfKey });
    await scenario.workerEvent({ type: "rx_done", rxId: rxId ?? "", pdfKey });

    const parts = await scenario.outbound();
    expect(
      parts.filter((part) => part.kind === "text" && part.text.includes("Panadol")),
      "the reading's text was not queued during the pause",
    ).toHaveLength(1);
    expect(
      parts.filter((part) => part.kind === "document" && part.mediaKey === pdfKey),
      "the PDF was not queued during the pause",
    ).toHaveLength(1);

    // One analysis, one reservation, not repeated by the failure.
    expect(await scenario.readings()).toHaveLength(1);
    const [wallet] = await ctx.owner.db
      .select({ id: creditWallets.id })
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, scenario.userId ?? ""));
    const reservations = await ctx.owner.db
      .select({ id: creditReservations.id })
      .from(creditReservations)
      .where(eq(creditReservations.walletId, wallet?.id ?? ""));
    expect(reservations).toHaveLength(1);

    // Paid work passes the pause; an ordinary reply does not.
    const queued = (await scenario.outbound()).length;
    await scenario.inbound({ text: "سؤال تاني" });
    await scenario.runTurns();
    expect((await scenario.outbound()).length).toBe(queued);
  });
});

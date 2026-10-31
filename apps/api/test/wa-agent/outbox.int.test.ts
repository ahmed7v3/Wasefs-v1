import { randomUUID } from "node:crypto";

import { rxAnalyses, waOutbox, type WaOutboxRow } from "@wasfa/db";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import { settingDefault } from "@wasfa/shared/settings";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EventPartsBuilder } from "../../src/wa-agent/outbox/outbox-parts.js";
import { WaOutboxRepo } from "../../src/wa-agent/outbox/wa-outbox.repo.js";
import { AdminTestContext } from "../support/admin-context.js";

import { Scenario } from "./scenarios/harness.js";

import type { WaAgentEvent } from "@wasfa/shared/schemas/wa-agent";

/*
 * The outbox deliverer (docs/WA-AGENT-RUNTIME.md §9): routing of results, the held / window / pause rules,
 * retries with backoff, the dead letter, and the lock + fence. Real Postgres and Redis; the deliverer's
 * timer is off in tests, so every scenario drives `sweep()` itself.
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

const RX_FAILED = (rxId: string): WaAgentEvent => ({
  type: "rx_failed",
  rxId,
  reason: "unreadable_image",
  creditsReturned: true,
});

async function chat(): Promise<Scenario> {
  const defaults = settingDefault("waAgent");
  const scenario = await Scenario.start(ctx, {
    model: () => "تمام",
    settings: { runtime: { ...defaults.runtime, v2: true } },
  });
  await scenario.inbound({ text: "مرحبا" });
  return scenario;
}

async function insertRow(
  scenario: Scenario,
  values: Partial<typeof waOutbox.$inferInsert> = {},
): Promise<WaOutboxRow> {
  const id = randomUUID();
  const [row] = await ctx.owner.db
    .insert(waOutbox)
    .values({
      conversationId: scenario.conversationId,
      kind: "document",
      idempotencyKey: `test:${id}`,
      payload: { type: "document_failed", conversationId: scenario.conversationId },
      state: "ready",
      paidWork: true,
      ...values,
    })
    .returning();
  if (!row) throw new Error("row not inserted");
  return row;
}

async function reload(id: string): Promise<WaOutboxRow> {
  const [row] = await ctx.owner.db.select().from(waOutbox).where(eq(waOutbox.id, id));
  if (!row) throw new Error("row vanished");
  return row;
}

const deliverer = (scenario: Scenario) => scenario.services.deliverer();

describe("event intake", () => {
  it("moves the waiting route to ready then delivered once, under duplicate events", async () => {
    const scenario = await chat();
    const rxId = randomUUID();
    const route = await insertRow(scenario, {
      kind: "rx_result",
      idempotencyKey: `rx:${rxId}`,
      refId: rxId,
      state: "waiting",
      payload: {},
    });

    await scenario.workerEvent(RX_FAILED(rxId));
    await scenario.workerEvent(RX_FAILED(rxId));
    await scenario.workerEvent(RX_FAILED(rxId));

    expect((await reload(route.id)).state).toBe("delivered");
    const texts = await scenario.outboundTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("الصورة مش واضحة");
    expect(texts[0]).toContain("ورجّعنا لك الرصيد");
  });

  it("an analysis without a route row (started before the switch) still arrives, once, during a pause", async () => {
    const scenario = await chat();
    const rxId = randomUUID();
    await ctx.redis.set(`wa:agent:rx:${rxId}`, scenario.conversationId);
    await scenario.ownerPause();

    await scenario.workerEvent(RX_FAILED(rxId));
    await scenario.workerEvent(RX_FAILED(rxId));

    expect(await scenario.outboundTexts()).toHaveLength(1);
  });

  it("a document failure is one row per event entry, however often it is redelivered", async () => {
    const scenario = await chat();
    const consumer = scenario.services.eventsConsumer();
    const event: WaAgentEvent = {
      type: "document_failed",
      conversationId: scenario.conversationId,
    };
    await consumer.process(event, "1730000000000-0");
    await consumer.process(event, "1730000000000-0");
    await deliverer(scenario).sweep();
    expect(await scenario.outboundTexts()).toHaveLength(1);
  });
});

describe("routes whose analysis ended without an event", () => {
  async function routeWithAnalysis(
    scenario: Scenario,
    status: "done" | "queued",
    finishedMinutesAgo: number,
  ) {
    const rxId = randomUUID();
    await ctx.owner.db.insert(rxAnalyses).values({
      id: rxId,
      ownerUserId: scenario.userId,
      createdBy: scenario.userId,
      status,
      mode: "balanced",
      skillVersion: "prescription-analysis@000000000000",
      ...(status === "done"
        ? { finishedAt: new Date(Date.now() - finishedMinutesAgo * 60_000) }
        : {}),
    });
    const route = await insertRow(scenario, {
      kind: "rx_result",
      idempotencyKey: `rx:${rxId}`,
      refId: rxId,
      state: "waiting",
      payload: {},
    });
    return route;
  }

  it("a finished analysis is delivered once by the sweep, a second sweep sends nothing", async () => {
    const scenario = await Scenario.start(ctx, {
      linked: true,
      model: () => "تمام",
      settings: { runtime: { ...settingDefault("waAgent").runtime, v2: true } },
    });
    await scenario.inbound({ text: "مرحبا" });
    const route = await routeWithAnalysis(scenario, "done", 1);
    vi.spyOn(EventPartsBuilder.prototype, "parts").mockResolvedValue([
      { kind: "text", text: "نتيجة الروشتة" },
    ]);
    deliverer(scenario).timing.promoteEveryMs = 0;

    await deliverer(scenario).sweep();
    expect((await reload(route.id)).state).toBe("delivered");
    expect(await scenario.outboundTexts()).toEqual(["نتيجة الروشتة"]);

    await deliverer(scenario).sweep();
    expect(await scenario.outboundTexts()).toEqual(["نتيجة الروشتة"]);
  });

  it("an analysis that is still queued leaves its route waiting", async () => {
    const scenario = await chat();
    const route = await routeWithAnalysis(scenario, "queued", 5);
    deliverer(scenario).timing.promoteEveryMs = 0;
    await deliverer(scenario).sweep();
    expect((await reload(route.id)).state).toBe("waiting");
    expect(await scenario.outbound()).toHaveLength(0);
  });
});

describe("what holds an item", () => {
  it("a blocked chat holds it, without sending", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    await scenario.services.state.block(scenario.conversationId);
    await deliverer(scenario).sweep();
    expect((await reload(row.id)).state).toBe("held");
    expect(await scenario.outbound()).toHaveLength(0);
  });

  it("a switched-off agent holds it", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    const current = await scenario.services.settings.get("waAgent");
    await scenario.services.settings.set(
      "waAgent",
      { ...current, enabled: false },
      { actorId: null },
    );
    await deliverer(scenario).sweep();
    expect((await reload(row.id)).state).toBe("held");
    await scenario.services.settings.set(
      "waAgent",
      { ...current, enabled: true },
      { actorId: null },
    );
  });

  it("paid work is delivered during an owner pause, other work is held", async () => {
    const scenario = await chat();
    await scenario.ownerPause();
    const paid = await insertRow(scenario, { paidWork: true });
    const other = await insertRow(scenario, { paidWork: false });

    await deliverer(scenario).sweep();

    expect((await reload(paid.id)).state).toBe("delivered");
    expect((await reload(other.id)).state).toBe("held");
    expect(await scenario.outbound()).toHaveLength(1);
  });

  it("paid work waits during a pause when the setting is off", async () => {
    const scenario = await chat();
    await scenario.ownerPause();
    const current = await scenario.services.settings.get("waAgent");
    await scenario.services.settings.set(
      "waAgent",
      { ...current, delivery: { paidWorkBypassesTakeover: false } },
      { actorId: null },
    );
    const paid = await insertRow(scenario);
    await deliverer(scenario).sweep();
    expect((await reload(paid.id)).state).toBe("held");
    await scenario.services.settings.set("waAgent", current, { actorId: null });
  });

  it("a closed 24 h window holds it; the next customer message delivers it first", async () => {
    const scenario = await chat();
    await scenario.passTime(25 * 60);
    const row = await insertRow(scenario);
    await deliverer(scenario).sweep();
    expect((await reload(row.id)).state).toBe("held");
    expect(await scenario.outbound()).toHaveLength(0);

    await scenario.inbound({ text: "أنا رجعت" });
    await deliverer(scenario).onCustomerMessage(scenario.conversationId);
    expect((await reload(row.id)).state).toBe("ready");
    await deliverer(scenario).sweep();
    expect((await reload(row.id)).state).toBe("delivered");
    expect(await scenario.outbound()).toHaveLength(1);
  });
});

describe("failures", () => {
  it("retries with the backoff, then ends dead with a dead letter after 8 attempts", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    vi.spyOn(scenario.services.outbound, "enqueueDelivery").mockRejectedValue(new Error("boom"));
    const waits = [10, 30, 120, 600, 1800, 1800, 1800];

    for (const [index, seconds] of waits.entries()) {
      await deliverer(scenario).sweep();
      const after = await reload(row.id);
      expect(after.state).toBe("ready");
      expect(after.attempts).toBe(index + 1);
      expect(after.lastError).toBe("Error");
      const delay = (after.nextAttemptAt.getTime() - Date.now()) / 1000;
      expect(delay).toBeGreaterThan(seconds - 5);
      expect(delay).toBeLessThanOrEqual(seconds + 1);
      await ctx.owner.db
        .update(waOutbox)
        .set({ nextAttemptAt: sql`now()` })
        .where(eq(waOutbox.id, row.id));
    }
    await deliverer(scenario).sweep();

    const dead = await reload(row.id);
    expect(dead.state).toBe("dead");
    expect(dead.attempts).toBe(8);
    const letters = await ctx.redis.xrange(WA_AGENT_DLQ_STREAM, "-", "+");
    const mine = letters.filter(
      ([, fields]) => fields.includes(row.id) || fields.some((f) => f.includes(row.id)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.[1].join(" ")).not.toContain("مرحبا");
    expect(await scenario.outbound()).toHaveLength(0);
  });

  it("a stale fence sends nothing and keeps the item for the next try", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    const real = scenario.services.outbound.enqueueDelivery.bind(scenario.services.outbound);
    vi.spyOn(scenario.services.outbound, "enqueueDelivery").mockImplementation(
      (id, parts, options) => real(id, parts, { ...options, fence: options.fence - 1 }),
    );
    await deliverer(scenario).sweep();
    const after = await reload(row.id);
    expect(after.state).toBe("ready");
    expect(after.attempts).toBe(0);
    expect(await scenario.outbound()).toHaveLength(0);
  });

  it("a conversation lock held elsewhere puts the item back without an attempt", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    await ctx.redis.set(`wa:agent:lock:${scenario.conversationId}`, "someone", "PX", 30_000);
    await deliverer(scenario).sweep();
    const after = await reload(row.id);
    expect(after.state).toBe("ready");
    expect(after.attempts).toBe(0);
    await ctx.redis.del(`wa:agent:lock:${scenario.conversationId}`);
  });
});

describe("two deliverers", () => {
  it("claim disjoint rows, and a published key is never sent twice", async () => {
    const scenario = await chat();
    const row = await insertRow(scenario);
    const repo = ctx.app.get(WaOutboxRepo);
    const [a, b] = await Promise.all([
      repo.claimDue(20, scenario.conversationId),
      repo.claimDue(20, scenario.conversationId),
    ]);
    expect(a.length + b.length).toBe(1);

    await repo.releaseHeld(scenario.conversationId);
    await ctx.owner.db.update(waOutbox).set({ state: "ready" }).where(eq(waOutbox.id, row.id));
    await Promise.all([deliverer(scenario).sweep(), deliverer(scenario).sweep()]);
    expect((await reload(row.id)).state).toBe("delivered");

    // A crash after the publish, before the state update: the next try finds the marker and sends nothing.
    await ctx.owner.db.update(waOutbox).set({ state: "ready" }).where(eq(waOutbox.id, row.id));
    await deliverer(scenario).sweep();
    expect((await reload(row.id)).state).toBe("delivered");
    expect(await scenario.outbound()).toHaveLength(1);
  });
});

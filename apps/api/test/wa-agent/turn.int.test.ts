import { randomUUID } from "node:crypto";

import { waTurns } from "@wasfa/db";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SettingsService } from "../../src/settings/settings.service.js";
import { StaleFenceError } from "../../src/wa-agent/turn/lock.js";
import { TURN_QUEUE, TurnQueue, turnDedupId } from "../../src/wa-agent/turn/turn.queue.js";
import { TurnStore } from "../../src/wa-agent/turn/turn.store.js";
import { AdminTestContext } from "../support/admin-context.js";

import { Scenario, V2Runtime } from "./scenarios/harness.js";

import type { RoundOutcome } from "../../src/wa-agent/turn/agent-round.js";

/*
 * The v2 turn engine against real Postgres and Redis (docs/WA-AGENT-RUNTIME.md §4.3, §17): fencing, the
 * runner's drain loop, crash retry, two workers on one conversation, and the debounced queue.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function turnsOf(conversationId: string) {
  return ctx.owner.db.select().from(waTurns).where(eq(waTurns.conversationId, conversationId));
}

describe("fencing", () => {
  it("a stale holder cannot insert the reply, link rows or close the turn; the current holder can", async () => {
    const scenario = await Scenario.start(ctx, { model: () => "x", runtime: new V2Runtime() });
    await scenario.inbound({ text: "مرحبا" });
    const id = scenario.conversationId;
    const store = ctx.app.get(TurnStore);
    const { outbound } = scenario.services;

    const unanswered = await store.unanswered(id);
    expect(unanswered).toHaveLength(1);
    const stale = await store.bumpFence(id);
    const turn = await store.begin(id, stale, unanswered);
    // Another worker took the conversation (our lock expired): its fence is newer.
    const current = await store.bumpFence(id);
    expect(current).toBe(stale + 1);

    const end = {
      ...store.endOf(turn, { costUsdMicros: 0, trace: [] } as unknown as RoundOutcome),
    };
    await expect(
      outbound.enqueueFenced(id, [{ kind: "text", text: "رد متأخر" }], end),
    ).rejects.toBeInstanceOf(StaleFenceError);
    await expect(
      store.endQuietly(turn, { costUsdMicros: 0, trace: [] } as unknown as RoundOutcome),
    ).rejects.toBeInstanceOf(StaleFenceError);

    expect(await scenario.outboundRows(), "no reply row was written").toHaveLength(0);
    expect(await scenario.outbound(), "nothing reached the bridge").toHaveLength(0);
    expect((await scenario.inboundRows()).every((row) => row.turnId === null)).toBe(true);
    expect((await turnsOf(id)).map((row) => row.state)).toEqual(["running"]);

    // The new holder resumes the same turn (attempt 2) and may write.
    const resumed = await store.begin(id, current, unanswered);
    expect(resumed.id).toBe(turn.id);
    expect(resumed.attempt).toBe(2);
    const ids = await outbound.enqueueFenced(id, [{ kind: "text", text: "الرد" }], {
      ...end,
      fence: current,
    });
    expect(ids).toHaveLength(1);
    expect(await scenario.outboundTexts()).toEqual(["الرد"]);
    expect((await scenario.inboundRows()).every((row) => row.turnId === turn.id)).toBe(true);
    const [reply] = await scenario.outboundRows();
    expect(reply?.turnId).toBe(turn.id);
    const [closed] = await turnsOf(id);
    expect(closed?.state).toBe("replied");
    expect(closed?.endedAt).not.toBeNull();
    expect(closed?.fence).toBe(current);
  });
});

describe("the runner", () => {
  it("a burst of three messages is one turn, one reply and three linked rows", async () => {
    const scenario = await Scenario.start(ctx, {
      model: () => "رد واحد",
      runtime: new V2Runtime(),
    });
    await scenario.inbound({ text: "١" });
    await scenario.inbound({ text: "٢" });
    await scenario.inbound({ text: "٣" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
    expect(await scenario.outboundTexts()).toEqual(["رد واحد"]);
    const turns = await turnsOf(scenario.conversationId);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.state).toBe("replied");
    expect(turns[0]?.inboundIds).toHaveLength(3);
    const inbound = await scenario.inboundRows();
    expect(inbound).toHaveLength(3);
    expect(inbound.every((row) => row.turnId === turns[0]?.id)).toBe(true);
    // The trace holds codes and counts, never text.
    expect(JSON.stringify(turns[0]?.trace)).not.toContain("رد واحد");
  });

  it("a message that arrives during a turn gets a second round of the same job", async () => {
    const chat: { current?: Scenario } = {};
    let calls = 0;
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: async () => {
        calls += 1;
        if (calls === 1) await chat.current?.inbound({ text: "وكمان سؤال" });
        return calls === 1 ? "رد ١" : "رد ٢";
      },
    });
    chat.current = scenario;
    await scenario.inbound({ text: "الأول" });
    await scenario.runTurns();

    expect(await scenario.outboundTexts()).toEqual(["رد ١", "رد ٢"]);
    expect(scenario.modelSaw(1)).toContain("وكمان سؤال");
    const turns = await turnsOf(scenario.conversationId);
    expect(turns.map((row) => row.state)).toEqual(["replied", "replied"]);
    expect((await scenario.inboundRows()).every((row) => row.turnId !== null)).toBe(true);
  });

  it("a crash leaves the rows unlinked and the retry replies on the same turn", async () => {
    let calls = 0;
    const runtime = new V2Runtime();
    const scenario = await Scenario.start(ctx, {
      runtime,
      model: () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return "بعد الإعادة";
      },
    });
    await scenario.inbound({ text: "سؤال" });
    const runner = runtime.runner(scenario);

    await expect(runner.run(scenario.conversationId)).rejects.toThrow();
    expect((await scenario.inboundRows()).every((row) => row.turnId === null)).toBe(true);
    expect(await scenario.outboundRows()).toHaveLength(0);
    const [crashed] = await turnsOf(scenario.conversationId);
    expect(crashed?.state).toBe("running");
    expect(crashed?.attempt).toBe(1);

    // The lock was released, so BullMQ's retry can take the conversation at once.
    expect(await runner.run(scenario.conversationId)).toBe("answered");
    await scenario.deliver();
    expect(await scenario.outboundTexts()).toEqual(["بعد الإعادة"]);
    const turns = await turnsOf(scenario.conversationId);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.id).toBe(crashed?.id);
    expect(turns[0]?.attempt).toBe(2);
    expect(turns[0]?.state).toBe("replied");
    expect((await scenario.inboundRows()).every((row) => row.turnId === crashed?.id)).toBe(true);
  });

  it("two workers on one conversation produce one reply; the loser comes back later", async () => {
    let calls = 0;
    const runtime = new V2Runtime();
    const scenario = await Scenario.start(ctx, {
      runtime,
      model: async () => {
        calls += 1;
        await sleep(400);
        return "رد واحد فقط";
      },
    });
    await scenario.inbound({ text: "سؤال" });
    const first = runtime.runner(scenario);
    const second = runtime.runner(scenario);

    const results = await Promise.all([
      first.run(scenario.conversationId),
      second.run(scenario.conversationId),
    ]);

    expect([...results].sort()).toEqual(["answered", "busy"]);
    expect(calls).toBe(1);
    expect(await scenario.outboundTexts()).toEqual(["رد واحد فقط"]);
    expect(await turnsOf(scenario.conversationId)).toHaveLength(1);
    // Only the loser asked for another job (the winner found nothing left).
    expect(runtime.requeued).toEqual([scenario.conversationId]);
  });
});

describe("the turn queue", () => {
  it("a burst of enqueues for one conversation is one delayed job, with ids free of colons", async () => {
    const queue = new TurnQueue(ctx.redis, ctx.app.get(SettingsService));
    const inspect = new Queue(TURN_QUEUE, { connection: ctx.redis });
    const first = randomUUID();
    const other = randomUUID();
    try {
      // Long delays: the app's own worker must not pick these up during the test.
      await queue.add(first, 120_000, 3);
      await queue.add(first, 120_000, 3);
      await queue.add(first, 120_000, 3);
      await queue.add(other, 120_000, 3);

      const delayed = await inspect.getDelayed();
      const mine = delayed.filter((job) => job.data.conversationId === first);
      expect(mine).toHaveLength(1);
      expect(delayed.filter((job) => job.data.conversationId === other)).toHaveLength(1);
      expect(turnDedupId(first)).not.toContain(":");
      expect(String(mine[0]?.id)).not.toContain(":");
      expect(mine[0]?.opts.attempts).toBe(4);
    } finally {
      await inspect.obliterate({ force: true });
      await inspect.close();
      await queue.onApplicationShutdown();
    }
  });
});

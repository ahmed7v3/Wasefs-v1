import { AiProviderError } from "@wasfa/ai";
import { errorEvents, waConversations, waTurns } from "@wasfa/db";
import { t } from "@wasfa/shared/i18n";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminTestContext } from "../support/admin-context.js";

import { Scenario, V2Runtime } from "./scenarios/harness.js";

/*
 * The v2 failure policy end to end (docs/WA-AGENT-RUNTIME.md section 5.4): every turn ends replied,
 * deferred, failed_replied or dropped_policy, the busy line is never sent for a model error, and nothing
 * the failure policy does ever pauses a chat.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const toolCall = (name: string, args: unknown = {}) => ({
  text: "",
  toolCalls: [{ id: `call-${name}`, name, arguments: args }],
});
const timesOut = (): never => {
  throw new DOMException("timed out", "TimeoutError");
};
type Step = string | ReturnType<typeof toolCall> | (() => never);
/** A model that plays one step per call; a function step throws when reached. */
const scripted =
  (...steps: Step[]) =>
  (_request: unknown, call: number) => {
    const step = steps[call] ?? "x";
    return typeof step === "function" ? step() : step;
  };
const busyLine = t("whatsapp.agent.busy", undefined, "ar");
const deferredText = t("whatsapp.agent.deferred", undefined, "ar");
const ackText = t("whatsapp.agent.fallback.ack", undefined, "ar");
const pausedText = t("whatsapp.agent.aiPaused", undefined, "ar");

const turnsOf = (conversationId: string) =>
  ctx.owner.db.select().from(waTurns).where(eq(waTurns.conversationId, conversationId));

describe("timeouts at each step", () => {
  it("step 1, before any tool: retried on the same step", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: scripted(timesOut, "تمام"),
    });
    await scenario.inbound({ text: "سؤال" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toEqual(["تمام"]);
    const [turn] = await turnsOf(scenario.conversationId);
    expect(turn?.state).toBe("replied");
  });

  it("step 2, after a read-only tool: still retried (repeating a read is harmless)", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: scripted(toolCall("get_catalog"), timesOut, "ده السعر"),
    });
    await scenario.inbound({ text: "كام السعر" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toEqual(["ده السعر"]);
    expect(scenario.modelInputs()).toHaveLength(3);
  });

  it("step 3, after an effect: no retry, the reply is built from the tool records", async () => {
    const scenario = await Scenario.start(ctx, {
      linked: true,
      runtime: new V2Runtime(),
      model: scripted(toolCall("offer_discount", { planKey: "pro", months: 1 }), timesOut),
    });
    await scenario.inbound({ text: "عايز خصم" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(2);
    const texts = await scenario.outboundTexts();
    expect(texts).not.toContain(busyLine);
    expect(texts).toHaveLength(1);
    const [turn] = await turnsOf(scenario.conversationId);
    expect(turn?.state).toBe("replied");
    expect(turn?.causeClass).toBe("after_tools");
    expect((await scenario.conversation()).status).toBe("active");
  });
});

describe("a 429 storm", () => {
  it("defers three times, then answers once with a reference; one deferral text, one failure text", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: () => new AiProviderError("rate_limited", 429),
    });
    await scenario.inbound({ text: "عايز أعرف الأسعار" });
    await scenario.runTurns();

    const texts = await scenario.outboundTexts();
    expect(texts).not.toContain(busyLine);
    expect(texts.filter((text) => text === deferredText)).toHaveLength(1);
    const failures = texts.filter((text) => text.includes("WSF-"));
    expect(failures).toHaveLength(1);
    expect(texts).toHaveLength(2);

    const [turn] = await turnsOf(scenario.conversationId);
    expect(turn?.state).toBe("failed_replied");
    expect(turn?.causeClass).toBe("transient");
    expect(turn?.errorRef).toMatch(/^WSF-/);
    expect(failures[0]).toContain(turn?.errorRef ?? "?");
    const [event] = await ctx.owner.db
      .select()
      .from(errorEvents)
      .where(eq(errorEvents.ref, turn?.errorRef ?? ""));
    expect(event).toBeDefined();
    expect((await scenario.conversation()).status).toBe("active");
    expect((await scenario.inboundRows()).every((row) => row.turnId === turn?.id)).toBe(true);
    // Codes and numbers only: no message text in the trace.
    expect(JSON.stringify(turn?.trace)).not.toContain("الأسعار");
  });
});

describe("an empty answer", () => {
  it("is asked again without tools and the new answer is sent", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: (_request, call) => (call === 0 ? "" : "الرد بعد السؤال تاني"),
    });
    await scenario.inbound({ text: "سؤال" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toEqual(["الرد بعد السؤال تاني"]);
    expect(scenario.modelInputs()[1]?.request.toolChoice).toBe("none");
  });

  it("stays empty: the short deterministic text is sent", async () => {
    const scenario = await Scenario.start(ctx, { runtime: new V2Runtime(), model: () => "" });
    await scenario.inbound({ text: "سؤال" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toEqual([ackText]);
    const [turn] = await turnsOf(scenario.conversationId);
    expect(turn?.state).toBe("replied");
  });
});

describe("the agent's spend cap", () => {
  it("sends one paused notice a day and alerts the owner once; the chat is never paused", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      settings: { spendCapUsdMicros: 0 },
      model: () => "x",
    });
    const alert = vi.spyOn(scenario.services.handoff, "alertOwner");
    const pause = vi.spyOn(scenario.services.handoff, "pauseWhenDelivered");
    await scenario.inbound({ text: "أول رسالة" });
    await scenario.runTurns();
    await scenario.inbound({ text: "تاني رسالة" });
    await scenario.runTurns();

    expect(await scenario.outboundTexts()).toEqual([pausedText]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
    expect((await scenario.conversation()).status).toBe("active");
    const turns = await turnsOf(scenario.conversationId);
    expect(turns.map((turn) => turn.state).sort()).toEqual(["dropped_policy", "failed_replied"]);
    expect(turns.every((turn) => turn.causeClass === "spend_cap")).toBe(true);
    expect(scenario.modelInputs()).toHaveLength(0);
  });
});

describe("a lost fence", () => {
  it("sends nothing and leaves the inbound rows for the new holder", async () => {
    const chat: { current?: Scenario } = {};
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: async () => {
        // Another worker takes the conversation while the model runs.
        await ctx.owner.db
          .update(waConversations)
          .set({ turnFence: sql`${waConversations.turnFence} + 1` })
          .where(eq(waConversations.id, chat.current?.conversationId ?? ""));
        throw new Error("unexpected failure");
      },
    });
    chat.current = scenario;
    await scenario.inbound({ text: "سؤال" });
    await scenario.runTurns();

    expect(await scenario.outbound()).toHaveLength(0);
    expect((await scenario.inboundRows()).every((row) => row.turnId === null)).toBe(true);
  });
});

describe("the customer-text limit", () => {
  it("a second failure within the window is deferred, not silent", async () => {
    const runtime = new V2Runtime();
    const scenario = await Scenario.start(ctx, {
      runtime,
      model: () => {
        throw new Error("unexpected failure");
      },
    });
    await scenario.inbound({ text: "أول رسالة" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toHaveLength(1);

    await scenario.inbound({ text: "تاني رسالة" });
    const runner = runtime.runner(scenario);
    expect(await runner.run(scenario.conversationId)).toBe("deferred");
    expect(await scenario.outboundTexts(), "no second text inside the window").toHaveLength(1);
    const deferred = (await turnsOf(scenario.conversationId)).find(
      (turn) => turn.state === "deferred",
    );
    expect(deferred).toBeDefined();
    expect(runtime.requeued).toContain(scenario.conversationId);

    // The retry runs after the wait: the customer is told now.
    await runner.run(scenario.conversationId);
    expect(await scenario.outboundTexts()).toHaveLength(2);
    expect((await scenario.conversation()).status).toBe("active");
  });
});

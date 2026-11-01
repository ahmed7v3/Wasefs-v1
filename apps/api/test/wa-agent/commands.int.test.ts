import { auditLogs, waAgentSessions, waMessages } from "@wasfa/db";
import { t } from "@wasfa/shared/i18n";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext } from "../support/admin-context.js";

import { TINY_JPEG } from "./scenarios/fixtures.js";
import { Scenario, V2Runtime } from "./scenarios/harness.js";

import type { WaSessionState } from "@wasfa/shared/wa-agent/session";

/*
 * The command layer through the v2 runner (docs/WA-AGENT-RUNTIME.md §7, §18.4): real Postgres, Redis, session,
 * registry, rx start and tool effects, a scripted model whose call count proves what needed no model.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const toolCall = (name: string) => ({
  text: "",
  toolCalls: [{ id: `call-${name}`, name, arguments: {} }],
});

/** A linked chat with credits on the v2 runner; the model answers from `script` by call number. */
function start(script: unknown[] = []) {
  return Scenario.start(ctx, {
    linked: true,
    credits: 100,
    runtime: new V2Runtime(),
    model: (_request, call) => (script[call] ?? "تمام") as never,
  });
}

async function sessionState(scenario: Scenario): Promise<WaSessionState> {
  const { sessionId } = await scenario.conversation();
  const [row] = await ctx.owner.db
    .select({ state: waAgentSessions.state })
    .from(waAgentSessions)
    .where(eq(waAgentSessions.id, sessionId ?? ""));
  return row?.state ?? {};
}

const startLine = (pages: number) =>
  t("whatsapp.agent.rx.starting", { pages: pages === 1 ? "صفحة" : `${String(pages)} صفحات` });

describe("«جديد»", () => {
  it("starts a clean session without a model call, and an analysis in flight is still delivered", async () => {
    const scenario = await start([toolCall("analyze_prescription"), "بقرأ الروشتة", "تمام صداع"]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    const [rxId] = await scenario.readings();
    expect(rxId, "the analysis should have started").toBeDefined();
    await scenario.inbound({ text: "عندي صداع من امبارح" });
    await scenario.runTurns();
    const before = (await scenario.conversation()).sessionId;
    const calls = scenario.modelInputs().length;

    await scenario.inbound({ text: "جديد" });
    await scenario.runTurns();
    expect(scenario.modelInputs(), "«جديد» must not call the model").toHaveLength(calls);
    expect((await scenario.conversation()).sessionId).not.toBe(before);
    expect((await scenario.outboundTexts()).some((text) => text.includes("بدأنا صفحة جديدة"))).toBe(
      true,
    );

    await scenario.inbound({ text: "ازيك" });
    await scenario.runTurns();
    expect(scenario.modelInputs()).toHaveLength(calls + 1);
    expect(scenario.modelSaw(calls), "the new session still shows the old chat").not.toContain(
      "عندي صداع",
    );

    await scenario.workerEvent({ type: "rx_done", rxId: rxId ?? "" });
    expect((await scenario.outboundTexts()).some((text) => text.includes("Panadol"))).toBe(true);
    expect((await scenario.inboundRows()).every((row) => row.turnId !== null)).toBe(true);
  });

  it("is a normal message inside a sentence", async () => {
    const scenario = await start(["ثواني أشوف"]);
    await scenario.inbound({ text: "عايز دوا جديد للصداع" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
    expect(await scenario.outboundTexts()).toEqual(["ثواني أشوف"]);
  });
});

describe("analyze", () => {
  it("starts the reading of a photo with no model call", async () => {
    const scenario = await start();
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.inbound({ text: "/analyze" });
    await scenario.runTurns();

    expect(scenario.modelInputs(), "the command path must not call the model").toHaveLength(0);
    expect(await scenario.readings()).toHaveLength(1);
    expect(await scenario.outboundTexts()).toEqual([startLine(1)]);
    expect((await scenario.inboundRows()).every((row) => row.turnId !== null)).toBe(true);
  });

  it("starts from the caption of the last page of a burst", async () => {
    const scenario = await start();
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.inbound({ image: TINY_JPEG, caption: "حلل" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(0);
    expect(await scenario.readings()).toHaveLength(1);
    expect(await scenario.outboundTexts()).toEqual([startLine(2)]);
  });

  it("does not read the same pictures twice", async () => {
    const scenario = await start();
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.inbound({ text: "حلل" });
    await scenario.runTurns();
    // The pictures are read already: a second command starts nothing and charges nothing.
    await scenario.inbound({ text: "حلل" });
    await scenario.runTurns();

    expect(await scenario.readings()).toHaveLength(1);
    expect(scenario.modelInputs()).toHaveLength(0);
  });

  it("waits for a photo and reads the next one on arrival", async () => {
    const scenario = await start();
    await scenario.inbound({ text: "/analyze" });
    await scenario.runTurns();

    expect(await scenario.outboundTexts()).toEqual([t("whatsapp.agent.commands.analyze.awaiting")]);
    expect((await sessionState(scenario)).awaitingRx).toBeDefined();
    expect(await scenario.readings()).toHaveLength(0);

    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    expect(scenario.modelInputs()).toHaveLength(0);
    expect(await scenario.readings()).toHaveLength(1);
    expect((await sessionState(scenario)).awaitingRx).toBeUndefined();
  });

  it("sends a guest to the sign-up path", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: () => "x",
    });
    await scenario.inbound({ text: "/analyze" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(0);
    expect(await scenario.outboundTexts()).toEqual([t("whatsapp.agent.commands.guest")]);
  });
});

describe("the numbered menu", () => {
  it("«2» after help is the second entry of the menu", async () => {
    const scenario = await start();
    await scenario.inbound({ text: "help" });
    await scenario.runTurns();
    const menu = (await scenario.outboundTexts()).join("\n");
    expect(menu).toContain("1.");
    expect(menu).toContain("9.");
    expect((await sessionState(scenario)).menu).toBeDefined();

    await scenario.inbound({ text: "2" });
    await scenario.runTurns();
    // MENU_ORDER[1] is `report`; this chat has no report yet.
    expect(await scenario.outboundTexts()).toContain(t("whatsapp.agent.commands.report.none"));
    expect((await sessionState(scenario)).menu).toBeUndefined();
    expect(scenario.modelInputs()).toHaveLength(0);
  });

  it("answers help and the digit in one turn", async () => {
    const scenario = await start();
    await scenario.inbound({ text: "مساعدة" });
    await scenario.inbound({ text: "٣" });
    await scenario.runTurns();

    const texts = await scenario.outboundTexts();
    expect(texts).toHaveLength(2);
    // MENU_ORDER[2] is `balance`.
    expect(texts[1]).toContain(t("whatsapp.agent.commands.balance.header"));
    expect(scenario.modelInputs()).toHaveLength(0);
  });

  it("a lone digit without a menu is an ordinary message", async () => {
    const scenario = await start(["تمام"]);
    await scenario.inbound({ text: "2" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
  });
});

describe("commands mixed with text", () => {
  it("answers the commands first, then the model answers the rest", async () => {
    const scenario = await start(["أهلا"]);
    await scenario.inbound({ text: "رصيدي" });
    await scenario.inbound({ text: "عندي صداع" });
    await scenario.runTurns();

    const texts = await scenario.outboundTexts();
    expect(texts[0]).toContain(t("whatsapp.agent.commands.balance.header"));
    expect(texts[1]).toBe("أهلا");
    expect(scenario.modelInputs()).toHaveLength(1);
    expect(scenario.modelSaw(0)).not.toContain("رصيدي");
  });

  it("gives the whole batch to the model when text comes first", async () => {
    const scenario = await start(["تمام"]);
    await scenario.inbound({ text: "عندي صداع" });
    await scenario.inbound({ text: "رصيدي" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
    expect(scenario.modelSaw(0)).toContain("رصيدي");
    expect(await scenario.outboundTexts()).toEqual(["تمام"]);
  });

  it("treats a command over the rate limit as a normal message", async () => {
    const scenario = await start(["تمام"]);
    await scenario.inbound({ text: "help" });
    await scenario.runTurns();
    await ctx.redis.set(`wa:agent:cmd:${scenario.conversationId}`, "20", "EX", 600);
    await scenario.inbound({ text: "help" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
  });
});

describe("voice and language preferences", () => {
  it("«بدون صوت» and «english» are kept in the profile and honoured", async () => {
    const scenario = await start(["Sure thing"]);
    await scenario.inbound({ text: "بدون صوت" });
    await scenario.inbound({ text: "english" });
    await scenario.runTurns();
    expect((await scenario.conversation()).profile).toEqual({ voice: "off", lang: "en" });
    expect(await scenario.outboundTexts()).toContain(t("whatsapp.agent.commands.lang.en"));

    await scenario.inbound({ text: "what can you do" });
    await scenario.runTurns();
    expect(scenario.modelInputs()[0]?.request.system).toContain("English");
  });
});

describe("privacy", () => {
  it("asks first, then deletes this chat only, with an audit row and no content", async () => {
    const scenario = await start(["تمام"]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    await scenario.inbound({ text: "عندي صداع" });
    await scenario.runTurns();
    const conversationId = scenario.conversationId;

    await scenario.inbound({ text: "امسح بياناتي" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toContain(t("whatsapp.agent.commands.privacy.ask"));
    expect((await scenario.rows()).length).toBeGreaterThan(3);
    expect((await sessionState(scenario)).privacyConfirm).toBeDefined();

    await scenario.inbound({ text: "تأكيد" });
    await scenario.runTurns();

    const left = await ctx.owner.db
      .select({ text: waMessages.text, direction: waMessages.direction })
      .from(waMessages)
      .where(eq(waMessages.conversationId, conversationId));
    expect(left.map((row) => row.text)).toEqual([t("whatsapp.agent.commands.privacy.done")]);
    expect(scenario.services.removedKeys).toHaveLength(1);
    const audit = (await ctx.owner.db.select().from(auditLogs)).filter(
      (row) => row.action === "wa_agent.privacy_delete" && row.targetId === conversationId,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("صداع");
    // The model never saw the command texts, and the chat has a fresh session.
    expect(scenario.modelInputs()).toHaveLength(2);
  });

  it("treats the confirm word as an ordinary message when nothing was asked", async () => {
    const scenario = await start(["تمام"]);
    await scenario.inbound({ text: "تأكيد" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(1);
    expect(scenario.services.removedKeys).toHaveLength(0);
  });
});

describe("human", () => {
  it("hands the chat over with the tool's confirmation and no model call", async () => {
    const scenario = await start();
    await scenario.inbound({ text: "كلم موظف" });
    await scenario.runTurns();

    expect(scenario.modelInputs()).toHaveLength(0);
    expect(await scenario.outboundTexts()).toEqual([t("whatsapp.agent.fallback.handoff_to_owner")]);
    expect((await scenario.conversation()).status).toBe("paused");
  });
});

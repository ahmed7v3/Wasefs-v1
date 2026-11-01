import { t } from "@wasfa/shared/i18n";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext } from "../support/admin-context.js";

import { TINY_JPEG } from "./scenarios/fixtures.js";
import { Scenario, V2Runtime } from "./scenarios/harness.js";

/*
 * The attachment registry, `analyze_prescription({ set | handles })` and `view_attachment` through the v2
 * runner (docs/WA-AGENT-RUNTIME.md §8, §18.5): a scripted model, the real session, registry, rx start and
 * tool effects, and the real transcript.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Call = { name: string; arguments?: unknown };
const calls = (...list: Call[]) => ({
  text: "",
  toolCalls: list.map((call, index) => ({
    id: `call-${String(index)}-${call.name}`,
    name: call.name,
    arguments: call.arguments ?? {},
  })),
});
const analyze = (args: unknown = {}) => calls({ name: "analyze_prescription", arguments: args });

/** A linked chat with enough credits, driven by the v2 runner, answering from `script` by model call. */
function start(script: unknown[]) {
  return Scenario.start(ctx, {
    linked: true,
    credits: 100,
    runtime: new V2Runtime(),
    model: (_request, call) => (script[call] ?? "تمام") as never,
  });
}

const PDF = Buffer.from("%PDF-1.4 tiny");

/** The analysis ids written on the customer's picture rows, by position. */
async function claimed(scenario: Scenario): Promise<(string | undefined)[]> {
  return (await scenario.inboundRows()).map((row) => (row.meta as { rxId?: string }).rxId);
}

describe("attachments in the v2 runner", () => {
  it("reads one picture and names it with its handle", async () => {
    const scenario = await start([analyze(), "بقرأ الروشتة"]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();

    expect(await scenario.readings()).toHaveLength(1);
    expect(scenario.modelSaw(0)).toContain("[صورة #1]");
    const system = scenario.modelInputs()[0]?.request.system ?? "";
    expect(system).toContain("المرفقات في المحادثة دي:");
    expect(system).toContain("#1 صورة · من أقل من دقيقة · جاهزة · مجموعة A");
    // The result of the tool carries what the note needs and no raw error.
    expect(scenario.modelSaw(1)).toMatch(
      /"started":true.*"rxRef":"[0-9a-f]{6}".*"handles":\["#1"\]/,
    );
  });

  it("reads three pictures of one burst as one prescription", async () => {
    const scenario = await start([analyze(), "بقرأ الروشتة"]);
    for (let index = 0; index < 3; index++) await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();

    const [first] = await scenario.readings();
    expect(await scenario.readings()).toHaveLength(1);
    expect(await claimed(scenario)).toEqual([first, first, first]);
    const system = scenario.modelInputs()[0]?.request.system ?? "";
    expect(system).toContain("#3 صورة");
    expect(scenario.imagesSeen(0)).toBe(3);
  });

  it("references six pictures and reads the sets one after the other", async () => {
    const scenario = await start([
      analyze(),
      "قريت المجموعة الأخيرة",
      analyze({ set: "A" }),
      "قريت الباقي",
    ]);
    for (let index = 0; index < 6; index++) await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    // Sets of four pages: A holds #1 to #4, B holds #5 and #6; the default reads the newest.
    const afterFirst = await claimed(scenario);
    expect(afterFirst.slice(0, 4)).toEqual([undefined, undefined, undefined, undefined]);
    expect(afterFirst[4]).toBeDefined();
    expect(afterFirst[5]).toBe(afterFirst[4]);
    expect(scenario.modelSaw(0).split("[صورة]")).toHaveLength(1);
    expect(scenario.imagesSeen(0)).toBe(4);

    // The first reading finished: only one reading may run per account at a time.
    await scenario.finishReadings();
    await scenario.inbound({ text: "آه كمل" });
    await scenario.runTurns();
    expect(await scenario.readings()).toHaveLength(2);
    const afterSecond = await claimed(scenario);
    expect(new Set(afterSecond.slice(0, 4)).size).toBe(1);
    expect(afterSecond[0]).toBeDefined();
  });

  it("lists a PDF and refuses to read it as a picture", async () => {
    const scenario = await start([
      analyze({ handles: ["#1"] }),
      "الملف ده PDF ومقدرش أقرأه كروشتة",
    ]);
    await scenario.inbound({ document: { bytes: PDF, mime: "application/pdf" } });
    await scenario.runTurns();

    const system = scenario.modelInputs()[0]?.request.system ?? "";
    expect(system).toContain("#1 ملف PDF");
    expect(scenario.modelSaw(0)).toContain("[ملف #1]");
    expect(scenario.modelSaw(1)).toContain("no_image");
    expect(scenario.modelSaw(1)).toContain(
      t("whatsapp.agent.tools.explain.no_image", undefined, "ar"),
    );
    expect(await scenario.readings()).toHaveLength(0);
  });

  it("reads a picture that is older than an hour (no time window)", async () => {
    const scenario = await start(["استلمت الصورة", analyze(), "بقرأ الروشتة"]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    await scenario.passTime(90);
    // Not a command alias («حلل الروشتة» is one and would skip the model): the model decides to read.
    await scenario.inbound({ text: "ممكن تقراها لي دلوقتي" });
    await scenario.runTurns();

    expect(await scenario.readings()).toHaveLength(1);
    expect(scenario.modelSaw(2)).toContain('"started":true');
  });

  it("refuses a second reading of a set that was read, with the fixed sentence", async () => {
    const scenario = await start([
      analyze(),
      "بقرأ الروشتة",
      analyze({ set: "A" }),
      "اتقرأت قبل كده",
    ]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    await scenario.inbound({ text: "حلليها تاني" });
    await scenario.runTurns();

    expect(await scenario.readings()).toHaveLength(1);
    const saw = scenario.modelSaw(3);
    expect(saw).toContain("already_analysed");
    expect(saw).toContain(t("whatsapp.agent.tools.explain.already_analysed", undefined, "ar"));
    // The first call is remembered in the history of the second turn, and the model sees both notes.
    expect(scenario.modelSaw(2)).toMatch(
      /\[أداة: analyze_prescription → started rx#[0-9a-f]{6} \(#1\)\]/,
    );
    const rows = await scenario.outboundRows();
    const notes = rows.map((row) => (row.meta as { toolNotes?: unknown[] }).toolNotes ?? []);
    expect(notes.flat()).toEqual([
      expect.objectContaining({ tool: "analyze_prescription", outcome: "ok", handles: ["#1"] }),
      expect.objectContaining({ tool: "analyze_prescription", outcome: "already_analysed" }),
    ]);
  });

  it("refuses a handle from an earlier session", async () => {
    const scenario = await start([
      "استلمت الصورة",
      analyze({ handles: ["#1"] }),
      "الصورة دي مش موجودة في المحادثة دي",
    ]);
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    // 13 hours of silence: the next message opens a new session, whose handles start again at #1.
    await scenario.passTime(13 * 60);
    await scenario.inbound({ text: "حلل #1" });
    await scenario.runTurns();

    expect(await scenario.readings()).toHaveLength(0);
    const saw = scenario.modelSaw(2);
    expect(saw).toContain("unknown_handle");
    expect(saw).toContain(t("whatsapp.agent.tools.explain.unknown_handle", undefined, "ar"));
  });

  it("shows a picture on request, two per turn, and refuses the third", async () => {
    const view = (handle: string) => ({ name: "view_attachment", arguments: { handle } });
    const scenario = await start([
      "استلمت الصور",
      calls(view("#1"), view("#2"), view("#3")),
      "دي الصور",
    ]);
    for (let index = 0; index < 3; index++) await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    await scenario.inbound({ text: "فيها إيه الصور دي؟" });
    await scenario.runTurns();

    const saw = scenario.modelSaw(2);
    expect(saw).toContain('"handle":"#1"');
    expect(saw).toContain('"handle":"#2"');
    expect(saw).toContain("view_limit");
    // No picture of the burst is pending in the second turn: the two pixels are the viewed ones.
    expect(scenario.imagesSeen(2)).toBe(2);
    expect(scenario.imagesSeen(1)).toBe(0);
  });
});

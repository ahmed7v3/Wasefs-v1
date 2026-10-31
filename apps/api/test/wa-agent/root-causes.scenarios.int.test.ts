import { AiProviderError } from "@wasfa/ai";
import { t } from "@wasfa/shared/i18n";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext } from "../support/admin-context.js";

import { redTest } from "./red.js";
import { TINY_JPEG } from "./scenarios/fixtures.js";
import { Scenario, V2Runtime } from "./scenarios/harness.js";

/*
 * Red scenario tests for the Phase 6 root causes (docs/WA-AGENT-RUNTIME.md section 2): R1, R3, R4, R5,
 * R6, R7, R8, R11, R13. Each body states the CORRECT v2 behaviour; today it fails on its own assertion
 * (the message starts with the root cause id, which `redTest` checks). R2, R9, R10, R12, R14 to R16 are
 * covered elsewhere.
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

const providerDown = () => new AiProviderError("unavailable");
const stepTimeout = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");
const busyLine = t("whatsapp.agent.busy", undefined, "ar");

describe("the harness", () => {
  it("a customer's text goes in and the scripted reply comes out", async () => {
    const scenario = await Scenario.start(ctx, { model: () => "أهلا بيك" });
    await scenario.inbound({ text: "السلام عليكم" });
    await scenario.runTurns();
    expect(await scenario.outboundTexts()).toEqual(["أهلا بيك"]);
    expect(scenario.modelInputs()).toHaveLength(1);
    expect((await scenario.inboundRows()).every((row) => "turn" in (row.meta as object))).toBe(
      true,
    );
  });
});

describe("root causes of the WhatsApp agent", () => {
  redTest(
    {
      id: "R1",
      fixedIn: "WP2",
      title: "an unanalysed picture can be analysed later, and the model remembers the first call",
      reason: /^R1: /,
    },
    async () => {
      // Picture A is read at once; picture B waits for the customer's go-ahead, 20 minutes later.
      const scenario = await Scenario.start(ctx, {
        linked: true,
        model: (_request, call) =>
          [
            toolCall("analyze_prescription"),
            "بقرأ الروشتة دلوقتي",
            "تحب أقرأ الصورة التانية كمان؟",
            toolCall("analyze_prescription"),
            "بقرأ الصورة التانية",
          ][call] ?? "تمام",
      });
      await scenario.inbound({ image: TINY_JPEG });
      await scenario.runTurns();
      await scenario.inbound({ image: TINY_JPEG });
      await scenario.runTurns();
      await scenario.passTime(20);
      await scenario.inbound({ text: "حلل الصورة التانية" });
      await scenario.runTurns();

      expect(
        scenario.modelSaw(4),
        "R1: the second call was answered no_image although the second picture was never analysed",
      ).not.toContain("no_image");
      expect(
        (await scenario.readings()).length,
        "R1: no second analysis started on the unanalysed picture",
      ).toBe(2);
      expect(
        scenario.modelSaw(3),
        "R1: the model's history has no note of the first analyze_prescription call",
      ).toContain("analyze_prescription");
    },
  );

  redTest(
    {
      id: "R3",
      fixedIn: "WP2",
      title: "six pictures in one burst are all referenced to the model",
      reason: /^R3: /,
    },
    async () => {
      const scenario = await Scenario.start(ctx, { model: () => "استلمت الصور" });
      for (let index = 0; index < 6; index++) await scenario.inbound({ image: TINY_JPEG });
      await scenario.runTurns();

      const seen = scenario.modelSaw(0);
      const placeholders = seen.split("[صورة]").length - 1;
      expect(
        placeholders,
        `R3: ${placeholders} of 6 pictures reached the model as a bare «[صورة]» placeholder (${scenario.imagesSeen(0)} shown)`,
      ).toBe(0);
    },
  );

  it("R4 a model error is not the busy line and does not pause the chat", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: () => providerDown(),
    });
    await scenario.inbound({ text: "عايز أعرف الأسعار" });
    await scenario.runTurns();

    expect(
      await scenario.outboundTexts(),
      "R4: the customer got the «server is busy» line for a model error",
    ).not.toContain(busyLine);
    expect(
      (await scenario.conversation()).status,
      "R4: the chat was paused automatically after a model error",
    ).toBe("active");
  });

  it("R5 a finished reading is delivered although the owner paused the chat meanwhile", async () => {
    const scenario = await Scenario.start(ctx, {
      linked: true,
      runtime: new V2Runtime(),
      model: (_request, call) => [toolCall("analyze_prescription"), "بقرأ الروشتة"][call] ?? "تمام",
    });
    await scenario.inbound({ image: TINY_JPEG });
    await scenario.runTurns();
    const [rxId] = await scenario.readings();
    expect(rxId, "harness: the analysis should have started").toBeDefined();

    await scenario.ownerPause();
    await scenario.workerEvent({ type: "rx_done", rxId: rxId ?? "" });

    const texts = await scenario.outboundTexts();
    expect(
      texts.some((text) => text.includes("Panadol")),
      "R5: the finished reading was not queued to the customer during the owner's pause",
    ).toBe(true);
  });

  it("R6 a second failure on a new message the same day is not silent", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: () => providerDown(),
    });
    await scenario.inbound({ text: "أول رسالة" });
    await scenario.runTurns();
    // The owner looked and resumed the chat; the model is still down for the next message.
    await scenario.ownerResume();
    const before = (await scenario.outbound()).length;

    await scenario.inbound({ text: "تاني رسالة" });
    await scenario.runTurns();

    expect(
      (await scenario.outbound()).length,
      "R6: the second message got no reply and no deferral line (silence)",
    ).toBeGreaterThan(before);
  });

  describe("R7 an unexpected error leaves the message unanswered", () => {
    const failingModel = async (
      chat: { current?: Scenario },
      seen: { marked?: boolean | undefined },
    ) => {
      seen.marked = (await chat.current?.inboundRows())?.some((row) => row.turnId !== null);
      throw new Error("unexpected failure");
    };

    it("R7 the inbound row is not linked while the model runs; the failure ending links it", async () => {
      const seen: { marked?: boolean | undefined } = {};
      const chat: { current?: Scenario } = {};
      const scenario = await Scenario.start(ctx, {
        runtime: new V2Runtime(),
        model: () => failingModel(chat, seen),
      });
      chat.current = scenario;
      await scenario.inbound({ text: "سؤال" });
      await scenario.runTurns();

      expect(
        seen.marked,
        "R7: the inbound row was already marked answered before the model produced anything",
      ).toBe(false);
      const rows = await scenario.inboundRows();
      // The turn ended `failed_replied`, so the row is answered by the failure text now.
      expect(rows.every((row) => row.turnId !== null)).toBe(true);
    });

    it("R7 the customer is told when a turn fails for good (failure policy, WP1.6)", async () => {
      const scenario = await Scenario.start(ctx, {
        runtime: new V2Runtime(),
        model: () => {
          throw new Error("unexpected failure");
        },
      });
      await scenario.inbound({ text: "سؤال" });
      await scenario.runTurns();
      expect(
        (await scenario.outboundTexts()).length,
        "R7: the customer got no failure text (silence)",
      ).toBeGreaterThan(0);
    });
  });

  it("R8 a slow conversation does not delay another one", async () => {
    const runtime = new V2Runtime();
    const slow = await Scenario.start(ctx, {
      runtime,
      model: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 2_000);
        });
        return "رد بطيء";
      },
    });
    const quick = await Scenario.start(ctx, { runtime, model: () => "رد سريع" });
    await slow.inbound({ text: "أنا الأول" });
    await quick.inbound({ text: "أنا التاني" });

    await Promise.all([slow.runTurns(), quick.runTurns()]);

    const [slowReply] = await slow.outboundRows();
    const [quickReply] = await quick.outboundRows();
    expect(slowReply && quickReply, "harness: both chats should have been answered").toBeTruthy();
    expect(
      quickReply?.createdAt.getTime() ?? Infinity,
      "R8: the second conversation's reply waited for the first one's slow model call",
    ).toBeLessThan(slowReply?.createdAt.getTime() ?? 0);
  });

  it("R11 a step timeout before any tool ran is retried", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: (_request, call) => {
        if (call === 0) throw stepTimeout();
        return "ده الرد بعد المحاولة التانية";
      },
    });
    await scenario.inbound({ text: "عايز أعرف حاجة" });
    await scenario.runTurns();

    expect(
      await scenario.outboundTexts(),
      "R11: the step timeout was not retried; the scripted second response never reached the customer",
    ).toContain("ده الرد بعد المحاولة التانية");
  });

  it("R13 an empty final answer after a tool ran still gets a fallback text", async () => {
    const scenario = await Scenario.start(ctx, {
      runtime: new V2Runtime(),
      model: (_request, call) => (call === 0 ? toolCall("get_catalog") : ""),
    });
    await scenario.inbound({ text: "كام سعر الباقات؟" });
    await scenario.runTurns();

    expect(
      (await scenario.outboundTexts()).length,
      "R13: the model's empty answer produced nothing for the customer (ghost reply)",
    ).toBeGreaterThan(0);
  });
});

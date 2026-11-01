import { stripBidi } from "@wasfa/shared/wa-agent/bidi";
import { plainForSpeech } from "@wasfa/shared/wa-agent/compose";
import { describe, expect, it } from "vitest";

import { composedReplyParts, rxStartLine } from "../../src/wa-agent/agent/rx-progress.js";
import { composeParts } from "../../src/wa-agent/compose/compose-parts.js";

import type { WaAgentSettings } from "@wasfa/shared/settings";

const caps = { maxReplyChars: 1000, maxMessagesPerTurn: 3 };
const texts = (parts: ReturnType<typeof composeParts>) =>
  parts.map((part) => (part.kind === "text" ? part.text : ""));

describe("composeParts", () => {
  it("turns **bold** into WhatsApp bold", () => {
    expect(texts(composeParts("this is **important**", caps))).toEqual(["this is *important*"]);
  });

  it("turns a table into bullet lines and a heading into a bold line", () => {
    const table = "## Prices\n| Drug | Price |\n| --- | --- |\n| Bepra | 20 |";
    expect(texts(composeParts(table, caps))).toEqual(["*Prices*\n• Bepra — 20"]);
  });

  it("isolates a Latin drug name inside an Arabic line", () => {
    expect(texts(composeParts("خد Bepra 20 mg قبل العشاء", caps))).toEqual([
      "‏خد ⁨Bepra 20 mg⁩ قبل العشاء",
    ]);
  });

  it("splits a long reply within the message and size caps", () => {
    const small = { maxReplyChars: 120, maxMessagesPerTurn: 3 };
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = texts(composeParts(long, small));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(120);
  });

  it("gives no parts for empty text", () => {
    expect(composeParts("  ", caps)).toEqual([]);
  });
});

describe("rx start line", () => {
  const started = (pages: number) => [
    { name: "analyze_prescription", result: { started: true, pages } },
  ];
  const config = { caps, language: "ar" } as unknown as WaAgentSettings;

  it("words the page count in Arabic singular, dual and plural", () => {
    expect(rxStartLine(started(1), "ar")).toContain("(صفحة)");
    expect(rxStartLine(started(2), "ar")).toContain("(صفحتين)");
    expect(rxStartLine(started(4), "ar")).toContain("(4 صفحات)");
    expect(rxStartLine(started(3), "en")).toContain("(3 pages)");
  });

  it("is absent when the reading was declined", () => {
    const declined = [{ name: "analyze_prescription", result: { started: false } }];
    expect(rxStartLine(declined, "ar")).toBeNull();
  });

  it("comes first, before the model text", () => {
    const parts = texts(composedReplyParts("Okay, done.", [], started(2), config));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("(صفحتين)");
    expect(parts[1]).toBe("Okay, done.");
  });

  it("is the whole reply when the model said nothing", () => {
    expect(composedReplyParts("", [], started(1), config)).toHaveLength(1);
    expect(composedReplyParts("", [], [], config)).toEqual([]);
  });
});

describe("plainForSpeech", () => {
  it("leaves no bidi controls or WhatsApp markers", () => {
    const source = "*خد* Bepra 20 mg _قبل_ العشاء\n• ~ok~ `x`";
    const composed = texts(composeParts(source, caps))[0] ?? "";
    expect(stripBidi(composed)).not.toBe(composed);
    const plain = plainForSpeech(composed);
    expect(plain).not.toMatch(/[‎‏⁦-⁩*_~`]/);
    expect(plain).not.toContain("• ");
    expect(plain).toContain("Bepra 20 mg");
  });
});

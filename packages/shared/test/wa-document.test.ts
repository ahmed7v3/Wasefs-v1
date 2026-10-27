import { describe, expect, it } from "vitest";

import { parseJobPayload } from "../src/queues.js";
import { waAgentEventSchema } from "../src/schemas/wa-agent.js";
import {
  WA_DOCUMENT_LIMITS,
  sanitizeFileName,
  waCreateDocumentArgsSchema,
  waDocumentKey,
  waDocumentKeySchema,
  waRenderDocumentPayloadSchema,
} from "../src/schemas/wa-document.js";

const ID = "018f0000-0000-7000-8000-0000000000c1";
const make = (template: string, content: unknown, extra: Record<string, unknown> = {}) => ({
  template,
  fileName: "file",
  content,
  ...extra,
});
const table = (rows: string[][], columns = ["a", "b"]) =>
  make("table", { title: "t", columns, rows });
const long = (n: number) => "x".repeat(n);

describe("create_document arguments", () => {
  it("accepts a valid document of each template", () => {
    const valid = [
      make("report", { title: "t", sections: [{ heading: "h", paragraphs: ["p"] }] }),
      table([["1", "2"]]),
      make("schedule", {
        title: "t",
        rows: [{ medicine: "m", dose: "d", times: ["8:00", "20:00"], notes: "n" }],
      }),
      make("card", { title: "t", lines: ["a"], footer: "f" }),
    ];
    for (const input of valid)
      expect(waCreateDocumentArgsSchema.safeParse(input).success).toBe(true);
  });

  it("refuses an unknown template, extra fields and missing content", () => {
    expect(waCreateDocumentArgsSchema.safeParse(make("poster", {})).success).toBe(false);
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", { title: "t", lines: ["a"], css: "x" }))
        .success,
    ).toBe(false);
    expect(waCreateDocumentArgsSchema.safeParse(make("report", undefined)).success).toBe(false);
    expect(
      waCreateDocumentArgsSchema.safeParse({ ...make("card", { title: "t", lines: ["a"] }), x: 1 })
        .success,
    ).toBe(false);
  });

  it("limits the report", () => {
    const report = (content: Record<string, unknown>) =>
      waCreateDocumentArgsSchema.safeParse(
        make("report", { title: "t", sections: [{ heading: "h", paragraphs: ["p"] }], ...content }),
      ).success;
    expect(report({})).toBe(true);
    expect(report({ title: long(WA_DOCUMENT_LIMITS.title + 1) })).toBe(false);
    expect(report({ sections: [] })).toBe(false);
    expect(
      report({ sections: Array.from({ length: 13 }, () => ({ heading: "h", paragraphs: [] })) }),
    ).toBe(false);
    expect(
      report({
        sections: [{ heading: "h", paragraphs: [long(WA_DOCUMENT_LIMITS.paragraph + 1)] }],
      }),
    ).toBe(false);
    expect(
      report({
        sections: [
          { heading: "h", paragraphs: [], bullets: Array.from({ length: 21 }, () => "b") },
        ],
      }),
    ).toBe(false);
  });

  it("limits the table: columns up to 6, rows up to 200, one cell per column", () => {
    expect(waCreateDocumentArgsSchema.safeParse(table([["1", "2"]])).success).toBe(true);
    const seven = Array.from({ length: 7 }, (_, i) => `c${String(i)}`);
    expect(waCreateDocumentArgsSchema.safeParse(table([seven], seven)).success).toBe(false);
    const row = ["a", "b"];
    expect(waCreateDocumentArgsSchema.safeParse(table(Array(200).fill(row))).success).toBe(true);
    expect(waCreateDocumentArgsSchema.safeParse(table(Array(201).fill(row))).success).toBe(false);
    expect(waCreateDocumentArgsSchema.safeParse(table([["only one"]])).success).toBe(false);
    expect(waCreateDocumentArgsSchema.safeParse(table([["", "b"]])).success).toBe(true);
  });

  it("limits the schedule and the card", () => {
    const schedule = (rows: unknown[]) =>
      waCreateDocumentArgsSchema.safeParse(make("schedule", { title: "t", rows })).success;
    const row = { medicine: "m", dose: "d", times: ["8:00"] };
    expect(schedule([row])).toBe(true);
    expect(schedule([])).toBe(false);
    expect(schedule([{ ...row, times: [] }])).toBe(false);
    expect(schedule([{ ...row, times: Array.from({ length: 9 }, () => "8:00") }])).toBe(false);
    expect(schedule(Array.from({ length: 31 }, () => row))).toBe(false);
    const card = (lines: string[]) =>
      waCreateDocumentArgsSchema.safeParse(make("card", { title: "t", lines })).success;
    expect(card(Array(8).fill("l"))).toBe(true);
    expect(card(Array(9).fill("l"))).toBe(false);
    expect(card([])).toBe(false);
    expect(card([long(121)])).toBe(false);
  });

  it("drops control characters from text and refuses text that is empty after that", () => {
    const parsed = waCreateDocumentArgsSchema.parse(
      make("card", { title: "a\u0000b\u0007", lines: ["x"] }),
    );
    expect(parsed.template === "card" && parsed.content.title).toBe("ab");
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", { title: "\u0000", lines: ["x"] })).success,
    ).toBe(false);
  });

  it("only takes ar or en as the language", () => {
    const card = { title: "t", lines: ["a"] };
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", card, { language: "en" })).success,
    ).toBe(true);
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", card, { language: "fr" })).success,
    ).toBe(false);
  });
});

describe("file names", () => {
  it("sanitizes paths, control and bidi characters and the extension", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe(".. .. etc passwd".replace(/^\.+\s*/, ""));
    expect(sanitizeFileName("report.pdf")).toBe("report");
    expect(sanitizeFileName("a‮b\u0000c.PNG")).toBe("a b c");
    expect(sanitizeFileName('x<y>:"z"|?*')).toBe("x y z");
    expect(sanitizeFileName("   ")).toBe("");
  });

  it("is at most 60 characters and never empty in a payload", () => {
    const content = { title: "t", lines: ["a"] };
    const parsed = waCreateDocumentArgsSchema.parse(make("card", content, { fileName: long(120) }));
    expect(Array.from(parsed.fileName)).toHaveLength(60);
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", content, { fileName: "///" })).success,
    ).toBe(false);
    expect(
      waCreateDocumentArgsSchema.safeParse(make("card", content, { fileName: long(201) })).success,
    ).toBe(false);
  });
});

describe("render job payload", () => {
  const payload = {
    conversationId: ID,
    language: "ar",
    ...make("card", { title: "t", lines: ["a"] }),
  };

  it("is registered on the documents queue", () => {
    expect(parseJobPayload("documents", "wa-agent.render-document", payload).ok).toBe(true);
    expect(
      parseJobPayload("documents", "wa-agent.render-document", { ...payload, conversationId: "x" })
        .ok,
    ).toBe(false);
    expect(
      parseJobPayload("documents", "wa-agent.render-document", { ...payload, language: undefined })
        .ok,
    ).toBe(false);
  });

  it("keeps the same content limits as the tool", () => {
    expect(
      waRenderDocumentPayloadSchema.safeParse({ ...payload, content: { title: "t", lines: [] } })
        .success,
    ).toBe(false);
  });
});

describe("generated document keys", () => {
  it("builds wa/out/<yyyy>/<mm>/<uuid>.<ext> in UTC and the schema accepts exactly that", () => {
    const key = waDocumentKey(new Date("2026-01-31T23:59:59Z"), ID, "pdf");
    expect(key).toBe(`wa/out/2026/01/${ID}.pdf`);
    expect(waDocumentKeySchema.safeParse(key).success).toBe(true);
    expect(waDocumentKeySchema.safeParse(`wa/out/2026/01/${ID}.exe`).success).toBe(false);
    expect(waDocumentKeySchema.safeParse(`wa/2026/01/${ID}.pdf`).success).toBe(false);
    expect(waDocumentKeySchema.safeParse(`wa/out/2026/01/../${ID}.pdf`).success).toBe(false);
  });
});

describe("document events", () => {
  const key = `wa/out/2026/10/${ID}.pdf`;
  it("accepts document_ready and document_failed", () => {
    expect(
      waAgentEventSchema.safeParse({
        type: "document_ready",
        conversationId: ID,
        mediaKey: key,
        fileName: "a.pdf",
        kind: "document",
      }).success,
    ).toBe(true);
    expect(
      waAgentEventSchema.safeParse({ type: "document_failed", conversationId: ID }).success,
    ).toBe(true);
  });

  it("refuses a ready event whose key is not a generated document", () => {
    expect(
      waAgentEventSchema.safeParse({
        type: "document_ready",
        conversationId: ID,
        mediaKey: "wa/2026/10/abcdefgh",
        fileName: "a.pdf",
        kind: "document",
      }).success,
    ).toBe(false);
  });

  it("carries an optional pdfKey on rx_done", () => {
    expect(waAgentEventSchema.safeParse({ type: "rx_done", rxId: ID }).success).toBe(true);
    expect(waAgentEventSchema.safeParse({ type: "rx_done", rxId: ID, pdfKey: key }).success).toBe(
      true,
    );
    expect(
      waAgentEventSchema.safeParse({ type: "rx_done", rxId: ID, pdfKey: "../x" }).success,
    ).toBe(false);
  });
});

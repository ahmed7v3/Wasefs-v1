import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ar, en } from "@wasfa/shared/i18n";
import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { buildHistory } from "../../src/wa-agent/agent/agent-prompt.js";
import { AttachmentViews, withViewedImages } from "../../src/wa-agent/agent/attachment-views.js";
import { renderAttachments } from "../../src/wa-agent/agent/attachments-prompt.js";
import { parseToolNotes, toolNoteLine, toolNotesOf } from "../../src/wa-agent/agent/tool-notes.js";
import { analyzePrescriptionTool } from "../../src/wa-agent/agent/tools/analyze-prescription.js";
import { explainKey } from "../../src/wa-agent/agent/tools/explain.js";
import { bindTools, type AgentToolContext } from "../../src/wa-agent/agent/tools/index.js";
import { viewAttachmentTool } from "../../src/wa-agent/agent/tools/view-attachment.js";
import { normalizeHandle } from "../../src/wa-agent/conversation/attachment-handle.js";
import {
  AttachmentsService,
  attachmentStatus,
  type Attachment,
} from "../../src/wa-agent/conversation/attachments.service.js";

import type { AttachmentRow } from "../../src/wa-agent/conversation/attachments.repo.js";
import type { ToolLoopCallInput } from "@wasfa/ai";
import type { TurnMessage } from "@wasfa/db";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const SESSION = "018f0000-0000-7000-8000-0000000000b1";

const row = (handle: number, over: Partial<AttachmentRow> = {}): AttachmentRow => ({
  messageId: `msg-${String(handle)}`,
  handle,
  kind: "image",
  mime: "image/jpeg",
  createdAt: new Date(NOW.getTime() - handle * 60_000),
  setLabel: "A",
  mediaKey: `wa/key-${String(handle)}`,
  mediaBytes: 100,
  mediaStatus: "ok",
  rxId: null,
  rxStatus: null,
  ...over,
});

/** The service over fixed rows; `asked` records the session ids the repo was asked for. */
function registry(rows: AttachmentRow[]) {
  const asked: string[] = [];
  const service = new AttachmentsService({
    rows: (sessionId: string, newest?: number) => {
      asked.push(sessionId);
      return Promise.resolve(newest === undefined ? rows : rows.slice(-newest));
    },
  } as never);
  return { service, asked };
}

describe("attachment status", () => {
  const base = { mediaKey: "k", mediaStatus: "ok", rxId: null, rxStatus: null } as const;

  it("is derived from the media row and its analysis", () => {
    expect(attachmentStatus(base)).toEqual({ kind: "ready" });
    expect(attachmentStatus({ ...base, mediaKey: null })).toEqual({ kind: "expired" });
    expect(attachmentStatus({ ...base, mediaKey: null, mediaStatus: "too_large" })).toEqual({
      kind: "failed",
      reason: "too_large",
    });
    const rxId = "a1b2c3d4-0000-7000-8000-000000000000";
    for (const rxStatus of ["queued", "processing", "verifying"] as const) {
      expect(attachmentStatus({ ...base, rxId, rxStatus })).toEqual({
        kind: "in_progress",
        rxRef: "a1b2c3",
      });
    }
    for (const rxStatus of ["done", "refunded", "failed"] as const) {
      expect(attachmentStatus({ ...base, rxId, rxStatus })).toEqual({
        kind: "analysed",
        rxRef: "a1b2c3",
      });
    }
    // An analysed file whose media retention deleted stays "analysed".
    expect(attachmentStatus({ ...base, mediaKey: null, rxId, rxStatus: "done" })).toEqual({
      kind: "analysed",
      rxRef: "a1b2c3",
    });
  });

  it("lists the newest eight with age, kind and set", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1));
    rows[9] = row(10, { kind: "document", mime: "application/pdf", setLabel: "B" });
    const { service, asked } = registry(rows);
    const list = await service.list(SESSION, NOW);
    expect(list.map((item) => item.handle)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(list.at(-1)).toMatchObject({ kind: "pdf", set: "B", ageSeconds: 600 });
    expect(asked).toEqual([SESSION]);
  });
});

describe("normalizeHandle", () => {
  it("reads #3, 3, '3' and Arabic digits", () => {
    expect(normalizeHandle("#3")).toBe(3);
    expect(normalizeHandle(" 3 ")).toBe(3);
    expect(normalizeHandle(3)).toBe(3);
    expect(normalizeHandle("#٣")).toBe(3);
    expect(normalizeHandle("#0")).toBeNull();
    expect(normalizeHandle("x")).toBeNull();
    expect(normalizeHandle(1.5)).toBeNull();
  });
});

describe("AttachmentsService.resolve", () => {
  it("refuses a handle that is not in this session", async () => {
    const { service, asked } = registry([row(1), row(2)]);
    expect(await service.resolve(SESSION, { handles: ["#9"] }, 4)).toEqual({
      ok: false,
      code: "unknown_handle",
    });
    expect(await service.resolve(SESSION, { handles: ["nope"] }, 4)).toEqual({
      ok: false,
      code: "unknown_handle",
    });
    expect(asked.every((id) => id === SESSION)).toBe(true);
  });

  it("refuses an analysed or running page by handle, and any page that is not ready", async () => {
    const rxId = "a1b2c3d4-0000-7000-8000-000000000000";
    const { service } = registry([
      row(1, { rxId, rxStatus: "done" }),
      row(2, { rxId, rxStatus: "queued" }),
      row(3, { mediaKey: null }),
      row(4, { mediaStatus: "download_failed", mediaKey: null }),
      row(5),
    ]);
    expect(await service.resolve(SESSION, { handles: [1] }, 4)).toEqual({
      ok: false,
      code: "already_analysed",
    });
    expect(await service.resolve(SESSION, { handles: ["#2", "#5"] }, 4)).toEqual({
      ok: false,
      code: "already_analysed",
    });
    expect(await service.resolve(SESSION, { handles: [3] }, 4)).toEqual({
      ok: false,
      code: "not_ready",
    });
    expect(await service.resolve(SESSION, { handles: [4, 5] }, 4)).toEqual({
      ok: false,
      code: "not_ready",
    });
  });

  it("refuses a PDF by handle and counts pages against maxPages", async () => {
    const { service } = registry([
      row(1, { kind: "document", mime: "application/pdf" }),
      row(2),
      row(3),
      row(4),
    ]);
    expect(await service.resolve(SESSION, { handles: [1] }, 4)).toEqual({
      ok: false,
      code: "no_image",
    });
    expect(await service.resolve(SESSION, { handles: [2, 3, 4] }, 2)).toEqual({
      ok: false,
      code: "too_many_pages",
    });
    expect(await service.resolve(SESSION, { handles: [4, "#2", 4] }, 3)).toEqual({
      ok: true,
      mediaIds: ["msg-2", "msg-4"],
      handles: [2, 4],
    });
  });

  it("takes the newest set that still has a ready page, only its ready pages, oldest first", async () => {
    const rxId = "a1b2c3d4-0000-7000-8000-000000000000";
    const { service } = registry([
      row(1, { setLabel: "A" }),
      row(2, { setLabel: "B", rxId, rxStatus: "done" }),
      row(3, { setLabel: "B" }),
      row(4, { setLabel: "B" }),
      row(5, { setLabel: "C", mediaKey: null }),
    ]);
    // C is expired and B's page 2 is analysed: the default reads B's ready pages 3 and 4.
    expect(await service.resolve(SESSION, {}, 4)).toEqual({
      ok: true,
      mediaIds: ["msg-3", "msg-4"],
      handles: [3, 4],
    });
    // A set by label reads its ready pages only; a set that does not exist is refused.
    expect(await service.resolve(SESSION, { set: "a" }, 4)).toMatchObject({
      ok: true,
      handles: [1],
    });
    expect(await service.resolve(SESSION, { set: "Z" }, 4)).toEqual({
      ok: false,
      code: "unknown_handle",
    });
    // Handles win over the set.
    expect(await service.resolve(SESSION, { set: "A", handles: [3] }, 4)).toMatchObject({
      ok: true,
      handles: [3],
    });
  });

  it("answers already_analysed when everything was read, and no_image when nothing is there", async () => {
    const rxId = "a1b2c3d4-0000-7000-8000-000000000000";
    const read = registry([row(1, { rxId, rxStatus: "done" })]);
    expect(await read.service.resolve(SESSION, {}, 4)).toEqual({
      ok: false,
      code: "already_analysed",
    });
    expect(await read.service.resolve(SESSION, { set: "A" }, 4)).toEqual({
      ok: false,
      code: "already_analysed",
    });
    const empty = registry([]);
    expect(await empty.service.resolve(SESSION, {}, 4)).toEqual({ ok: false, code: "no_image" });
  });
});

describe("renderAttachments", () => {
  const list: Attachment[] = [
    {
      messageId: "a",
      handle: 3,
      kind: "image",
      ageSeconds: 130,
      set: "A",
      status: { kind: "ready" },
    },
    {
      messageId: "b",
      handle: 4,
      kind: "pdf",
      ageSeconds: 7_300,
      set: "B",
      status: { kind: "analysed", rxRef: "a1b2c3" },
    },
    {
      messageId: "c",
      handle: 5,
      kind: "image",
      ageSeconds: 20,
      set: null,
      status: { kind: "failed", reason: "too_large" },
    },
  ];

  it("renders one line per file in Arabic", () => {
    const text = renderAttachments(list, "ar") ?? "";
    expect(text.split("\n").slice(0, 4)).toEqual([
      "المرفقات في المحادثة دي:",
      "#3 صورة · من ٢ دقيقة · جاهزة · مجموعة A",
      "#4 ملف PDF · من ٢ ساعة · اتحللت (rx#a1b2c3) · مجموعة B",
      "#5 صورة · من أقل من دقيقة · فشل التحميل (too_large)",
    ]);
    expect(text).toContain("view_attachment");
  });

  it("renders the English equivalent and nothing for an empty session", () => {
    const text = renderAttachments(list, "en") ?? "";
    expect(text.split("\n").slice(0, 3)).toEqual([
      "Attachments in this conversation:",
      "#3 picture · 2 min ago · ready · set A",
      "#4 PDF · 2 h ago · analysed (rx#a1b2c3) · set B",
    ]);
    expect(renderAttachments([], "ar")).toBeNull();
  });
});

describe("explain texts", () => {
  const files = [
    "agent/tools/index.ts",
    "agent/tools/send-media.ts",
    "agent/tools/create-account.ts",
    "agent/tools/view-attachment.ts",
    "agent/attachment-views.ts",
    "agent/agent-signup.service.ts",
    "commerce/agent-discount.service.ts",
    "commerce/agent-subscription.service.ts",
    "commerce/agent-medical.service.ts",
    "commerce/usage-errors.ts",
    "documents/agent-document.service.ts",
    "rx/rx-start.service.ts",
    "conversation/attachments.service.ts",
  ];
  const patterns = [
    /(?:toolError|fail|declined|refused|withdrawn)\(\s*(?:[\w.]+,\s*)?"([a-z_]+)"/g,
    /(?:reason|error|code):\s*"([a-z_]+)"/g,
  ];
  // Codes a service returns through a function the source scan cannot follow.
  const returned = [
    "quota_reached",
    "insufficient_credits",
    "plan_feature",
    "busy",
    "unavailable",
    "too_many_pages",
    "coupon_unavailable",
    "no_bank_method",
    "quote_expired",
    "order_failed",
    "proof_limit",
    "proof_not_allowed",
    "still_processing",
    "rate_limited",
    "no_pending_payment",
    "attach_failed",
    "inactive",
    "two_factor",
    "privileged",
    "lifetime_limit",
    "daily_cap",
  ];

  const codes = new Set<string>(returned);
  for (const file of files) {
    const source = readFileSync(
      fileURLToPath(new URL(`../../src/wa-agent/${file}`, import.meta.url)),
      "utf8",
    );
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) codes.add(match[1] ?? "");
    }
  }

  it("scans a real set of codes", () => {
    for (const code of [
      "not_linked",
      "already_analysed",
      "unknown_handle",
      "view_limit",
      "no_image",
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it("has an Arabic and an English sentence for every refusal code a tool returns", () => {
    const missing = [...codes].filter((code) => {
      const key = explainKey(code);
      return key === null || !Object.hasOwn(en, key) || !Object.hasOwn(ar, key);
    });
    expect(missing).toEqual([]);
  });

  it("gives no explain to an unknown code", () => {
    expect(explainKey("not_a_real_code")).toBeNull();
  });
});

describe("bindTools refusals and notes", () => {
  function setup(result: unknown, language: "ar" | "en" = "ar") {
    const ctx = {
      conversationId: "c1",
      userId: "u1",
      market: { currency: "EGP", country: "EG" },
      config: { ...settingDefault("waAgent"), language },
      now: NOW,
      deps: { usage: { analyzePrescription: () => Promise.resolve(result) } },
      mediaParts: [],
      handoffReason: null,
    } as unknown as AgentToolContext;
    const records: Parameters<typeof bindTools>[2] = [];
    const { handlers } = bindTools([analyzePrescriptionTool], ctx, records);
    return { call: handlers["analyze_prescription"], records };
  }

  it("adds the fixed sentence to a declined analysis and keeps its code in the note", async () => {
    const { call, records } = setup({ started: false, reason: "already_analysed" });
    const result = await call?.({ handles: ["#3", 4] });
    expect(result).toEqual({
      started: false,
      reason: "already_analysed",
      explain: "الروشتة دي اتحللت قبل كده، النتيجة اتبعتت في رسالة فوق.",
    });
    expect(toolNotesOf(records)).toEqual([
      { tool: "analyze_prescription", outcome: "already_analysed", handles: ["#3", "#4"] },
    ]);
  });

  it("keeps rxRef and handles of a started analysis", async () => {
    const { call, records } = setup({ started: true, rxRef: "a1b2c3", handles: ["#3", "#4"] });
    const result = await call?.({});
    expect(result).not.toHaveProperty("explain");
    expect(toolNotesOf(records)).toEqual([
      { tool: "analyze_prescription", outcome: "ok", rxRef: "a1b2c3", handles: ["#3", "#4"] },
    ]);
  });

  it("explains an invalid call in the configured language", async () => {
    const { call } = setup({}, "en");
    expect(await call?.({ set: "123" })).toMatchObject({
      error: "invalid_arguments",
      explain: expect.stringContaining("incomplete or malformed"),
    });
  });
});

describe("tool memory in history", () => {
  const message = (
    over: Partial<TurnMessage> & { handle?: number | null; toolNotes?: unknown },
  ): TurnMessage & { handle?: number | null; toolNotes?: unknown } => ({
    id: "m",
    direction: "out",
    kind: "text",
    text: null,
    mediaKey: null,
    mediaMime: null,
    mediaBytes: null,
    createdAt: NOW,
    answered: true,
    ...over,
  });

  it("renders a started analysis and a refusal as lines before the reply", () => {
    const messages = buildHistory([
      message({ id: "1", direction: "in", text: "حلل" }),
      message({
        id: "2",
        text: "بقرأ الروشتة",
        toolNotes: [
          { tool: "analyze_prescription", outcome: "ok", rxRef: "a1b2c3", handles: ["#3", "#4"] },
          { tool: "analyze_prescription", outcome: "already_analysed", handles: ["#3"] },
        ],
      }),
    ]);
    const reply = messages[1]?.parts[0];
    expect(reply).toEqual({
      type: "text",
      text: [
        "[أداة: analyze_prescription → started rx#a1b2c3 (#3 #4)]",
        "[أداة: analyze_prescription → already_analysed (#3)]",
        "بقرأ الروشتة",
      ].join("\n"),
    });
  });

  it("uses the English form for an English chat and ignores malformed notes", () => {
    expect(
      toolNoteLine(
        { tool: "analyze_prescription", outcome: "ok", rxRef: "a1b2c3", handles: ["#3"] },
        "en",
      ),
    ).toBe("[tool: analyze_prescription → started rx#a1b2c3 (#3)]");
    expect(parseToolNotes("nope")).toEqual([]);
    expect(parseToolNotes([{ tool: 1 }])).toEqual([]);
  });

  it("never leaves a bare picture placeholder for a picture that has a handle", () => {
    const rows = [1, 2, 3].map((handle) =>
      message({ id: `p${String(handle)}`, direction: "in", kind: "image", handle }),
    );
    const text = buildHistory(rows)
      .flatMap((m) => m.parts)
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(text.split("[صورة]")).toHaveLength(1);
    expect(text).toContain("[صورة #1]");
    expect(text).toContain("[صورة #3]");
    // A picture with pixels attached and a handle keeps the marker beside the pixels.
    const [first] = rows;
    const withPixels = buildHistory(
      first === undefined ? [] : [first],
      [{ messageId: "p1", mime: "image/jpeg", data: new Uint8Array([1]) }],
      "en",
    );
    expect(withPixels[0]?.parts).toEqual([
      { type: "image", mime: "image/jpeg", data: new Uint8Array([1]) },
      { type: "text", text: "[picture #1]" },
    ]);
  });

  it("leaves reads out of the notes", () => {
    expect(
      toolNotesOf([
        { name: "get_catalog", ok: true },
        { name: "view_attachment", ok: true },
        { name: "start_subscription", ok: false, code: "no_bank_method" },
      ]),
    ).toEqual([{ tool: "start_subscription", outcome: "no_bank_method" }]);
  });
});

describe("view_attachment", () => {
  const image = new Uint8Array([9, 9]);
  const found = (handle: number) => ({
    messageId: `msg-${String(handle)}`,
    handle,
    kind: "image" as const,
    ageSeconds: 5,
    set: "A",
    status: { kind: "ready" as const },
    mediaKey: "k",
    mediaMime: "image/jpeg",
    mediaBytes: 2,
  });
  const views = (state: Record<number, ReturnType<typeof found> | null> = {}) =>
    new AttachmentViews(
      SESSION,
      { find: (_session: string, handle: number) => Promise.resolve(state[handle] ?? null) },
      { loadOne: () => Promise.resolve({ mime: "image/jpeg", data: image }) },
      () => NOW,
      "ar",
    );

  it("answers two views per turn and refuses the third", async () => {
    const turn = views({ 1: found(1), 2: found(2), 3: found(3) });
    expect(await turn.request("#1")).toEqual({ ok: true, handle: "#1" });
    expect(await turn.request(2)).toEqual({ ok: true, handle: "#2" });
    expect(await turn.request("#3")).toEqual({ error: "view_limit" });
  });

  it("refuses a handle of another session, a deleted file and a failed one", async () => {
    const turn = views({
      1: { ...found(1), kind: "image", status: { kind: "expired" } },
      2: { ...found(2), status: { kind: "failed", reason: "too_large" } },
    });
    expect(await turn.request("#7")).toEqual({ error: "unknown_handle" });
    expect(await turn.request("x")).toEqual({ error: "unknown_handle" });
    expect(await turn.request("#1")).toEqual({ error: "not_ready" });
    expect(await turn.request("#2")).toEqual({ error: "not_ready" });
  });

  it("hands the pixels to the next model step once", async () => {
    const turn = views({ 1: found(1) });
    await turn.request("#1");
    const step: ToolLoopCallInput = {
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      tools: [],
      toolChoice: "auto",
      allowFallback: true,
    };
    const next = withViewedImages(step, turn);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1]).toEqual({
      role: "user",
      parts: [
        { type: "image", mime: "image/jpeg", data: image },
        { type: "text", text: "[الصورة #1 زي ما طلبت تشوفها]" },
      ],
    });
    expect(withViewedImages(step, turn)).toBe(step);
    expect(withViewedImages(step, undefined)).toBe(step);
  });

  it("is a read tool that refuses outside v2", async () => {
    expect(viewAttachmentTool.effect).toBe("read");
    const ctx = { config: settingDefault("waAgent") } as unknown as AgentToolContext;
    expect(await viewAttachmentTool.handler(ctx, { handle: "#1" })).toEqual({
      error: "view_unavailable",
    });
  });
});

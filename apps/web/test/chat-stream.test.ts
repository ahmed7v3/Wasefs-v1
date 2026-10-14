import { describe, expect, it } from "vitest";

import { groupChatsByDate } from "../src/lib/chat-history";
import { chatReducer, EMPTY_CHAT, toDisplayMessage } from "../src/lib/chat-state";
import { createSseParser } from "../src/lib/chat-stream";

import type { ChatState } from "../src/lib/chat-state";
import type { ChatMessageView, ChatSummaryView } from "@wasfa/shared/schemas/chat";

function collect(chunks: string[]) {
  const events: Array<[string, string]> = [];
  const parser = createSseParser((name, data) => events.push([name, data]));
  for (const chunk of chunks) parser.push(chunk);
  parser.flush();
  return events;
}

const WIRE =
  'event: message_id\ndata: {"userMessageId":"u","assistantMessageId":"a"}\n\n' +
  'event: text\ndata: {"delta":"مرحبا"}\n\n' +
  "event: heartbeat\ndata: {}\n\n" +
  'event: done\ndata: {"status":"done"}\n\n';

describe("SSE parser", () => {
  it("parses whole events", () => {
    expect(collect([WIRE]).map(([name]) => name)).toEqual([
      "message_id",
      "text",
      "heartbeat",
      "done",
    ]);
    expect(collect([WIRE])[1]?.[1]).toBe('{"delta":"مرحبا"}');
  });

  it("gives the same events whatever the chunk boundaries", () => {
    const whole = collect([WIRE]);
    for (const size of [1, 2, 3, 7, 19]) {
      const chunks = [];
      for (let at = 0; at < WIRE.length; at += size) chunks.push(WIRE.slice(at, at + size));
      expect(collect(chunks)).toEqual(whole);
    }
  });

  it("handles CRLF, a CRLF split between chunks, comments and multi-line data", () => {
    expect(collect([": ping\r\nevent: text\r\ndata: a\r\ndata: b\r\n\r\n"])).toEqual([
      ["text", "a\nb"],
    ]);
    expect(collect(["event: text\r", "\ndata: x\r\n", "\r\n"])).toEqual([["text", "x"]]);
  });

  it("delivers a last event the connection closed before its blank line", () => {
    expect(collect(["event: done\ndata: {}"])).toEqual([["done", "{}"]]);
  });

  it("skips events without data", () => {
    expect(collect(["event: text\n\n"])).toEqual([]);
  });
});

function apply(actions: Parameters<typeof chatReducer>[1][], from: ChatState = EMPTY_CHAT) {
  return actions.reduce(chatReducer, from);
}

const turn = {
  type: "turn",
  userMessageId: "u1",
  assistantMessageId: "a1",
  content: "سؤال",
  imageCount: 1,
  regenerate: false,
  searching: true,
} as const;

describe("chat reducer", () => {
  it("builds the answer in place from the stream", () => {
    const state = apply([
      turn,
      { type: "delta", text: "", thinking: "hmm " },
      { type: "delta", text: "جواب", thinking: "" },
      { type: "delta", text: " كامل", thinking: "" },
      { type: "source", source: { url: "https://example.org", title: "T", domain: "example.org" } },
      { type: "source", source: { url: "https://example.org", title: "T", domain: "example.org" } },
      { type: "thought", seconds: 3 },
      { type: "credits", charged: 4 },
      { type: "finish", status: "done" },
    ]);
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.messages[0]).toMatchObject({ content: "سؤال", imageCount: 1 });
    expect(state.messages[1]).toMatchObject({
      content: "جواب كامل",
      thinking: "hmm ",
      thinkingSeconds: 3,
      creditsCharged: 4,
      status: "done",
      searching: false,
    });
    expect(state.messages[1]?.sources).toHaveLength(1);
  });

  it("ignores deltas once the answer finished", () => {
    const done = apply([turn, { type: "finish", status: "stopped" }]);
    expect(apply([{ type: "delta", text: "late", thinking: "" }], done)).toBe(done);
  });

  it("marks a failure on the streaming answer", () => {
    const state = apply([turn, { type: "fail", text: "فشل" }]);
    expect(state.messages[1]).toMatchObject({ status: "error", errorText: "فشل" });
  });

  it("replaces the last answer when regenerating, keeping the question", () => {
    const first = apply([
      turn,
      { type: "delta", text: "قديم", thinking: "" },
      { type: "finish", status: "done" },
    ]);
    const again = apply(
      [
        { ...turn, assistantMessageId: "a2", regenerate: true },
        { type: "delta", text: "جديد", thinking: "" },
      ],
      first,
    );
    expect(again.messages.map((m) => m.id)).toEqual(["u1", "a2"]);
    expect(again.messages[1]?.content).toBe("جديد");
  });

  it("prepends older pages without duplicates", () => {
    const view = (id: string): ChatMessageView => ({
      id,
      role: "user",
      content: id,
      status: "done",
      parts: [],
      creditsCharged: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const state = apply([
      { type: "history", messages: [toDisplayMessage(view("b")), toDisplayMessage(view("c"))] },
      { type: "older", messages: [toDisplayMessage(view("a")), toDisplayMessage(view("b"))] },
    ]);
    expect(state.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("shows a stored answer left in streaming as stopped, with its parts", () => {
    const shown = toDisplayMessage({
      id: "x",
      role: "assistant",
      content: "partial",
      status: "streaming",
      parts: [
        { type: "thought", seconds: 5 },
        { type: "source", url: "https://example.org", title: "T", domain: "example.org" },
      ],
      creditsCharged: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(shown).toMatchObject({ status: "stopped", thinkingSeconds: 5 });
    expect(shown.sources).toHaveLength(1);
  });
});

describe("history grouping", () => {
  const chat = (id: string, updatedAt: string): ChatSummaryView => ({
    id,
    title: id,
    skill: null,
    archived: false,
    createdAt: updatedAt,
    updatedAt,
  });

  it("buckets by local calendar day, newest first, leaving empty buckets out", () => {
    const now = new Date(2026, 5, 15, 12, 0, 0);
    const at = (daysBack: number, hour = 9) => new Date(2026, 5, 15 - daysBack, hour).toISOString();
    const groups = groupChatsByDate(
      [chat("a", at(0)), chat("b", at(1, 23)), chat("c", at(5)), chat("d", at(30))],
      now,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["today", ["a"]],
      ["yesterday", ["b"]],
      ["week", ["c"]],
      ["older", ["d"]],
    ]);
    expect(groupChatsByDate([chat("a", at(0))], now).map((g) => g.key)).toEqual(["today"]);
  });
});

// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../src/lib/api-error";
import { streamChatMessage } from "../src/lib/chat-stream";
import { useChatTurn } from "../src/lib/use-chat-turn";

const CHAT = "0b8f1c52-6b3e-4a39-9c1e-3f1d9b7a2c10";
const encoder = new TextEncoder();

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A response whose body the test feeds by hand, so it can stop mid-answer. */
function openStream(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener("abort", () => {
        c.error(new DOMException("aborted", "AbortError"));
      });
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push: (text: string) => {
      controller.enqueue(encoder.encode(text));
    },
    end: () => {
      controller.close();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChatMessage", () => {
  it("turns a refusal before the stream into an ApiRequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { code: "UPSTREAM_UNAVAILABLE", message: "x", details: { reason: "ai_paused" } },
            { status: 503 },
          ),
        ),
      ),
    );
    await expect(
      streamChatMessage(
        CHAT,
        { mode: "balanced", content: "hi" },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ details: { reason: "ai_paused" } });
  });

  it("skips events it does not know", async () => {
    const stream = openStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(stream.response)),
    );
    const seen: string[] = [];
    const done = streamChatMessage(
      CHAT,
      { mode: "fast", content: "hi" },
      new AbortController().signal,
      (e) => seen.push(e.event),
    );
    stream.push(frame("from_the_future", { a: 1 }) + frame("text", { delta: "a" }));
    stream.end();
    await done;
    expect(seen).toEqual(["text"]);
  });
});

describe("useChatTurn", () => {
  const ids = {
    userMessageId: "11111111-1111-4111-8111-111111111111",
    assistantMessageId: "22222222-2222-4222-8222-222222222222",
  };

  it("streams an answer, applies the credits and announces completion once", async () => {
    const stream = openStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(stream.response)),
    );
    const onBalance = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useChatTurn({ onBalance, onSettled }));

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.run(CHAT, { content: "سؤال", mode: "balanced", search: false });
    });
    stream.push(frame("message_id", ids));
    stream.push(frame("thinking", { delta: "hmm" }));
    stream.push(frame("text", { delta: "جواب " }) + frame("text", { delta: "كامل" }));
    await waitFor(() => {
      expect(result.current.messages[1]?.content).toBe("جواب كامل");
    });
    expect(result.current.streaming).toBe(true);
    expect(result.current.announcement).toBe("");

    stream.push(frame("credits", { charged: 3, balance: 97 }) + frame("done", { status: "done" }));
    stream.end();
    await act(async () => {
      await finished;
    });
    expect(result.current.streaming).toBe(false);
    expect(result.current.messages[1]).toMatchObject({
      status: "done",
      creditsCharged: 3,
      thinking: "hmm",
    });
    expect(result.current.announcement).toBe("اكتملت الإجابة.");
    expect(onBalance).toHaveBeenCalledWith(97);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("stop aborts the request and keeps the partial answer as stopped", async () => {
    let aborted = false;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const stream = openStream(init?.signal);
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      queueMicrotask(() => {
        stream.push(frame("message_id", ids) + frame("text", { delta: "نص جزئي" }));
      });
      return Promise.resolve(stream.response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatTurn());

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.run(CHAT, { content: "سؤال", mode: "fast", search: false });
    });
    await waitFor(() => {
      expect(result.current.messages[1]?.content).toBe("نص جزئي");
    });
    act(() => {
      result.current.stop();
    });
    await act(async () => {
      await finished;
    });
    expect(aborted).toBe(true);
    expect(result.current.messages[1]).toMatchObject({ status: "stopped", content: "نص جزئي" });
    expect(result.current.error).toBeNull();
    expect(result.current.announcement).toBe("تم إيقاف الإجابة.");
  });

  it("keeps a pre-stream refusal as the error and adds no messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { code: "PAYMENT_REQUIRED", message: "x", details: { reason: "plan_feature" } },
            { status: 402 },
          ),
        ),
      ),
    );
    const { result } = renderHook(() => useChatTurn());
    await act(async () => {
      await result.current.run(CHAT, { content: "سؤال", mode: "deep", search: false });
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
  });

  it("shows an in-stream error on the answer without a technical detail", async () => {
    const stream = openStream();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(stream.response)),
    );
    const { result } = renderHook(() => useChatTurn());
    let finished!: Promise<void>;
    act(() => {
      finished = result.current.run(CHAT, { content: "سؤال", mode: "balanced", search: false });
    });
    stream.push(
      frame("message_id", ids) + frame("error", { code: "INTERNAL", reason: "provider_error" }),
    );
    stream.end();
    await act(async () => {
      await finished;
    });
    expect(result.current.messages[1]).toMatchObject({
      status: "error",
      errorText: "تعذّر الحصول على إجابة الآن. حاول مرة أخرى بعد قليل.",
    });
  });
});

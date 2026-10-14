"use client";

import { t } from "@wasfa/shared/i18n";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { errorMessage } from "../components/error-notice";

import { ApiRequestError, extractErrorRef } from "./api-error";
import { chatReducer, EMPTY_CHAT } from "./chat-state";
import { streamChatMessage } from "./chat-stream";

import type { AiMode } from "@wasfa/shared/ai";
import type { ChatEvent, SendMessageInput } from "@wasfa/shared/schemas/chat";
import type { ChatDisplayMessage } from "@wasfa/ui";

/** Runs `callback` on the next animation frame (a timer where there is none, e.g. in tests). */
function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(callback);
    return () => {
      cancelAnimationFrame(handle);
    };
  }
  const handle = setTimeout(callback, 16);
  return () => {
    clearTimeout(handle);
  };
}

export interface TurnInput {
  /** The question; absent when regenerating. */
  content?: string;
  fileIds?: string[];
  mode: AiMode;
  search: boolean;
  /** The assistant message to answer again. */
  regenerate?: string;
}

export interface UseChatTurnOptions {
  /** The wallet balance after a settlement (`credits` event). */
  onBalance?: (balance: number) => void;
  /** The turn ended in any way: the history list may have a new title or order. */
  onSettled?: () => void;
}

/** The text the user sees for a failure that arrived inside the stream. */
export function streamErrorText(event: {
  code: string;
  reason?: string | undefined;
  ref?: string | undefined;
}): string {
  const error = new ApiRequestError(
    event.code,
    "",
    event.ref,
    0,
    event.reason ? { reason: event.reason } : undefined,
  );
  const ref = extractErrorRef(error);
  return ref ? `${errorMessage(error)} ${t("common.errorRef", { ref })}` : errorMessage(error);
}

/**
 * One chat's messages and the turn in flight. Text and thinking deltas are collected and applied once
 * per animation frame (not per token), so the page re-renders at most 60 times a second however fast
 * the model writes. Leaving the page does not cancel an answer: only Stop does, and the server
 * settles whatever was produced either way.
 */
export function useChatTurn(options: UseChatTurnOptions = {}) {
  const [state, dispatch] = useReducer(chatReducer, EMPTY_CHAT);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");

  const running = useRef<AbortController | null>(null);
  const buffer = useRef({ text: "", thinking: "" });
  const cancelFrame = useRef<(() => void) | null>(null);
  const thinkStartedAt = useRef<number | null>(null);
  const thoughtReported = useRef(false);
  const settings = useRef(options);
  useEffect(() => {
    settings.current = options;
  });

  const flush = useCallback(() => {
    cancelFrame.current?.();
    cancelFrame.current = null;
    const { text, thinking } = buffer.current;
    if (text === "" && thinking === "") return;
    buffer.current = { text: "", thinking: "" };
    dispatch({ type: "delta", text, thinking });
  }, []);

  const schedule = useCallback(() => {
    cancelFrame.current ??= nextFrame(() => {
      cancelFrame.current = null;
      flush();
    });
  }, [flush]);

  const reportThought = useCallback(() => {
    if (thinkStartedAt.current === null || thoughtReported.current) return;
    thoughtReported.current = true;
    dispatch({
      type: "thought",
      seconds: Math.max(1, Math.round((Date.now() - thinkStartedAt.current) / 1000)),
    });
  }, []);

  useEffect(() => {
    return () => {
      cancelFrame.current?.();
    };
  }, []);

  const run = useCallback(
    async (chatId: string, input: TurnInput) => {
      if (running.current) return;
      const controller = new AbortController();
      running.current = controller;
      setStreaming(true);
      setError(null);
      setAnnouncement("");
      buffer.current = { text: "", thinking: "" };
      thinkStartedAt.current = null;
      thoughtReported.current = false;

      let started = false;
      let finished = false;
      const onEvent = (event: ChatEvent) => {
        switch (event.event) {
          case "message_id":
            started = true;
            flush();
            dispatch({
              type: "turn",
              userMessageId: event.data.userMessageId,
              assistantMessageId: event.data.assistantMessageId,
              content: input.content ?? "",
              imageCount: input.fileIds?.length ?? 0,
              regenerate: input.regenerate !== undefined,
              searching: input.search,
            });
            break;
          case "thinking":
            thinkStartedAt.current ??= Date.now();
            buffer.current.thinking += event.data.delta;
            schedule();
            break;
          case "text":
            reportThought();
            buffer.current.text += event.data.delta;
            schedule();
            break;
          case "source":
            dispatch({ type: "source", source: event.data });
            break;
          case "credits":
            flush();
            dispatch({ type: "credits", charged: event.data.charged });
            settings.current.onBalance?.(event.data.balance);
            break;
          case "done":
            finished = true;
            flush();
            reportThought();
            dispatch({ type: "finish", status: event.data.status });
            setAnnouncement(
              t(event.data.status === "done" ? "chat.announce.done" : "chat.announce.stopped"),
            );
            break;
          case "error":
            finished = true;
            flush();
            dispatch({ type: "fail", text: streamErrorText(event.data) });
            break;
          case "heartbeat":
            break;
        }
      };

      const body: Pick<SendMessageInput, "mode"> & Partial<Omit<SendMessageInput, "mode">> =
        input.regenerate !== undefined
          ? { mode: input.mode, search: input.search, regenerate: input.regenerate }
          : {
              mode: input.mode,
              search: input.search,
              fileIds: input.fileIds ?? [],
              ...(input.content === undefined ? {} : { content: input.content }),
            };

      try {
        await streamChatMessage(chatId, body, controller.signal, onEvent);
        // The server closed the stream without saying how it ended: treat it as a dropped connection.
        if (started && !finished) {
          flush();
          dispatch({ type: "fail", text: t("error.UPSTREAM_UNAVAILABLE") });
        }
      } catch (caught) {
        flush();
        if (controller.signal.aborted) {
          // Stop: the server settles the partial answer; show it as it is.
          reportThought();
          dispatch({ type: "finish", status: "stopped" });
          setAnnouncement(t("chat.announce.stopped"));
        } else if (started) {
          dispatch({ type: "fail", text: errorMessage(caught) });
        } else {
          setError(caught);
        }
      } finally {
        running.current = null;
        setStreaming(false);
        settings.current.onSettled?.();
      }
    },
    [flush, schedule, reportThought],
  );

  const stop = useCallback(() => {
    running.current?.abort();
  }, []);

  const setMessages = useCallback((messages: ChatDisplayMessage[]) => {
    dispatch({ type: "history", messages });
  }, []);

  const prependMessages = useCallback((messages: ChatDisplayMessage[]) => {
    dispatch({ type: "older", messages });
  }, []);

  return {
    messages: state.messages,
    streaming,
    error,
    announcement,
    run,
    stop,
    setMessages,
    prependMessages,
    clearError: () => {
      setError(null);
    },
  };
}

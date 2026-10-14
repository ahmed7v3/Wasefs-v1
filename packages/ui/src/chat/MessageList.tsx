"use client";

import { t } from "@wasfa/shared/i18n";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../cn";

import { Message, type ChatDisplayMessage, type MessageFeedback } from "./Message";

import type { ReactNode } from "react";

export interface MessageListProps {
  messages: readonly ChatDisplayMessage[];
  onRegenerate?: ((messageId: string) => void) | undefined;
  onFeedback?: ((messageId: string, feedback: MessageFeedback | null) => void) | undefined;
  /** Older messages exist: shows the "load older" button at the top. */
  hasOlder?: boolean | undefined;
  onLoadOlder?: (() => void) | undefined;
  /** Read out once when an answer completes (never per token). Empty = nothing to announce. */
  announcement?: string | undefined;
  /** Content shown below the messages (an error notice). */
  footer?: ReactNode;
  className?: string | undefined;
}

/** How close to the end still counts as "following" the conversation. */
const FOLLOW_PX = 64;

/**
 * The conversation. It follows the newest text while the user stays at the bottom, stops following
 * as soon as they scroll up (and offers "↓ جديد" to jump back), and has a polite live region that
 * speaks only when an answer completes.
 */
export function MessageList({
  messages,
  onRegenerate,
  onFeedback,
  hasOlder = false,
  onLoadOlder,
  announcement = "",
  footer,
  className,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousCount = useRef(0);
  const [hasNew, setHasNew] = useState(false);

  const toBottom = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    following.current = true;
    setHasNew(false);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const last = messages.at(-1);
    // The user just sent something: they want to see it, wherever they were.
    if (messages.length > previousCount.current && last?.role === "user") following.current = true;
    previousCount.current = messages.length;
    if (following.current) {
      element.scrollTop = element.scrollHeight;
    } else if (last?.role === "assistant" && last.status === "streaming") {
      setHasNew(true);
    }
  }, [messages]);

  const lastAssistant = messages.findLast((message) => message.role === "assistant");

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
          if (following.current) setHasNew(false);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-4 sm:px-4"
      >
        {hasOlder ? (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={onLoadOlder}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("chat.message.loadOlder")}
            </button>
          </div>
        ) : null}
        <ol aria-label={t("chat.messages.label")} className="mx-auto flex max-w-3xl flex-col gap-8">
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              canRegenerate={message.id === lastAssistant?.id && message.status !== "streaming"}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
            />
          ))}
        </ol>
        {footer ? <div className="mx-auto mt-6 max-w-3xl">{footer}</div> : null}
      </div>
      {hasNew ? (
        <button
          type="button"
          onClick={toBottom}
          aria-label={t("chat.scrollDown.label")}
          className="absolute bottom-3 start-1/2 inline-flex min-h-11 -translate-x-1/2 items-center rounded-full bg-primary px-4 text-sm font-semibold text-on-primary shadow-raised hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus rtl:translate-x-1/2"
        >
          {t("chat.scrollDown")}
        </button>
      ) : null}
      <div role="status" aria-live="polite" aria-atomic className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

"use client";

import { t } from "@wasfa/shared/i18n";
import { Check, Copy, ImageIcon, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { cn } from "../cn";

import { Markdown } from "./Markdown";
import { SourceChips, type SourceChip } from "./SourceChips";
import { ThinkingPanel } from "./ThinkingPanel";

export interface ChatDisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** `error`: the answer did not complete; `stopped`: the user cut it short. */
  status: "streaming" | "done" | "stopped" | "error";
  /** The model's reasoning so far; empty when it did not think. */
  thinking?: string | undefined;
  thinkingSeconds?: number | undefined;
  /** A web search is running. */
  searching?: boolean | undefined;
  sources?: readonly SourceChip[] | undefined;
  /** Pictures attached to a user message. */
  imageCount?: number | undefined;
  creditsCharged?: number | undefined;
  /** The sentence shown when the answer failed (already translated, never provider details). */
  errorText?: string | undefined;
}

export type MessageFeedback = "good" | "bad";

export interface MessageProps {
  message: ChatDisplayMessage;
  /** Only the last answer can be regenerated. */
  canRegenerate?: boolean | undefined;
  onRegenerate?: ((messageId: string) => void) | undefined;
  onFeedback?: ((messageId: string, feedback: MessageFeedback | null) => void) | undefined;
}

const action =
  "inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors duration-150 " +
  "hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

export const Message = memo(function Message({
  message,
  canRegenerate = false,
  onRegenerate,
  onFeedback,
}: MessageProps) {
  if (message.role === "user") return <UserMessage message={message} />;
  return (
    <AssistantMessage
      message={message}
      canRegenerate={canRegenerate}
      onRegenerate={onRegenerate}
      onFeedback={onFeedback}
    />
  );
});

function UserMessage({ message }: { message: ChatDisplayMessage }) {
  return (
    <li className="flex flex-col items-end gap-2">
      <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary-soft px-4 py-3 text-base leading-8 text-text">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {message.imageCount ? (
          <p className="mt-1 flex items-center gap-1 text-sm text-text-muted">
            <ImageIcon aria-hidden className="size-4" />
            {t("chat.message.image")}
            {message.imageCount > 1 ? ` (${message.imageCount})` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AssistantMessage({
  message,
  canRegenerate,
  onRegenerate,
  onFeedback,
}: Required<Pick<MessageProps, "canRegenerate">> & Omit<MessageProps, "canRegenerate">) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<MessageFeedback | null>(null);
  const streaming = message.status === "streaming";
  const hasThinking = Boolean(message.thinking) || message.thinkingSeconds !== undefined;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2_000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = () => {
    // A denied clipboard (insecure context, permissions) leaves the button unchanged.
    navigator.clipboard.writeText(message.content).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  const rate = (next: MessageFeedback) => {
    const value = feedback === next ? null : next;
    setFeedback(value);
    onFeedback?.(message.id, value);
  };

  return (
    <li className="flex flex-col gap-3" aria-busy={streaming}>
      <p className="m-0 text-sm font-semibold text-primary">{t("chat.message.assistant")}</p>
      {hasThinking ? (
        <ThinkingPanel
          text={message.thinking ?? ""}
          streaming={streaming && message.content === ""}
          seconds={message.thinkingSeconds}
        />
      ) : null}
      {message.searching ? (
        <p className="m-0 text-sm text-text-muted">{t("chat.search.active")}</p>
      ) : null}
      {message.content ? (
        <Markdown>{message.content}</Markdown>
      ) : streaming && !hasThinking ? (
        <p className="m-0 text-base text-text-muted">{t("chat.message.writing")}</p>
      ) : null}
      {message.status === "stopped" ? (
        <p className="m-0 text-sm text-text-muted">{t("chat.message.stopped")}</p>
      ) : null}
      {message.status === "error" ? (
        <p role="alert" className="m-0 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {message.errorText ?? t("chat.message.failed")}
        </p>
      ) : null}
      {message.sources && message.sources.length > 0 ? (
        <SourceChips sources={message.sources} />
      ) : null}
      <p className="m-0 text-xs text-text-muted">{t("chat.disclaimer")}</p>
      {!streaming ? (
        <div className="-ms-2 flex flex-wrap items-center gap-1">
          {message.content ? (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? t("chat.message.copied") : t("chat.message.copy")}
              title={copied ? t("chat.message.copied") : t("chat.message.copy")}
              className={action}
            >
              {copied ? (
                <Check aria-hidden className="size-5" />
              ) : (
                <Copy aria-hidden className="size-5" />
              )}
            </button>
          ) : null}
          {canRegenerate ? (
            <button
              type="button"
              onClick={() => onRegenerate?.(message.id)}
              aria-label={t("chat.message.regenerate")}
              title={t("chat.message.regenerate")}
              className={action}
            >
              <RotateCcw aria-hidden className="size-5 rtl:-scale-x-100" />
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={feedback === "good"}
            onClick={() => {
              rate("good");
            }}
            aria-label={t("chat.message.good")}
            title={t("chat.message.good")}
            className={cn(action, feedback === "good" && "bg-primary-soft text-primary")}
          >
            <ThumbsUp aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-pressed={feedback === "bad"}
            onClick={() => {
              rate("bad");
            }}
            aria-label={t("chat.message.bad")}
            title={t("chat.message.bad")}
            className={cn(action, feedback === "bad" && "bg-primary-soft text-primary")}
          >
            <ThumbsDown aria-hidden className="size-5" />
          </button>
          {message.creditsCharged ? (
            <span className="ms-2 text-xs text-text-muted">
              {t("chat.message.charged", { charged: message.creditsCharged })}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

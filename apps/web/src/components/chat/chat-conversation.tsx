"use client";

import { t } from "@wasfa/shared/i18n";
import {
  chatMessagesPageSchema,
  chatSummarySchema,
  type ChatSummaryView,
} from "@wasfa/shared/schemas/chat";
import { buttonStyles, EmptyState, MessageList, Skeleton } from "@wasfa/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { announceChatsChanged, takePendingSend } from "../../lib/chat-pending";
import { skillLabel } from "../../lib/chat-skills";
import { toDisplayMessage } from "../../lib/chat-state";
import { useChatComposer } from "../../lib/use-chat-composer";
import { useChatTurn } from "../../lib/use-chat-turn";
import { ErrorNotice } from "../error-notice";

import { ChatComposerPanel } from "./chat-composer-panel";

type LoadState = "loading" | "ready" | "missing" | "error";

/** The title is written in the background after the first answer; look again a little later. */
const TITLE_REFRESH_MS = [3_000, 9_000];

export function ChatConversation({ chatId }: { chatId: string }) {
  const composer = useChatComposer();
  const [chat, setChat] = useState<ChatSummaryView | null>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const startedPending = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { setBalance } = composer.capabilities;

  const refreshSummary = useCallback(() => {
    api(`/ai/chats/${chatId}`, { schema: chatSummarySchema }).then(setChat, () => undefined);
  }, [chatId]);

  const turn = useChatTurn({
    onBalance: setBalance,
    onSettled: () => {
      announceChatsChanged();
      refreshSummary();
      for (const delay of TITLE_REFRESH_MS) {
        timers.current.push(
          setTimeout(() => {
            announceChatsChanged();
            refreshSummary();
          }, delay),
        );
      }
    },
  });
  const { run, setMessages, prependMessages } = turn;

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.length = 0;
    };
  }, []);

  // A message typed on `/ai` was handed over with the new chat: start its answer right away.
  useEffect(() => {
    if (startedPending.current) return;
    const pending = takePendingSend(chatId);
    if (!pending) return;
    startedPending.current = true;
    void run(chatId, {
      content: pending.content,
      fileIds: pending.fileIds,
      mode: pending.mode,
      search: pending.search,
    });
  }, [chatId, run]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fail = (error: unknown) => {
      if (signal.aborted) return;
      if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
        setLoad("missing");
      } else {
        setLoadError(error);
        setLoad("error");
      }
    };
    api(`/ai/chats/${chatId}`, { schema: chatSummarySchema, signal })
      .then((summary) => {
        setChat(summary);
        if (startedPending.current) {
          setLoad("ready");
          return;
        }
        return api(`/ai/chats/${chatId}/messages`, { schema: chatMessagesPageSchema, signal }).then(
          (page) => {
            setMessages(page.items.map(toDisplayMessage).reverse());
            setOlderCursor(page.nextCursor);
            setLoad("ready");
          },
        );
      }, fail)
      .catch(fail);
    return () => {
      controller.abort();
    };
  }, [chatId, setMessages]);

  const loadOlder = () => {
    if (!olderCursor) return;
    api(`/ai/chats/${chatId}/messages?cursor=${encodeURIComponent(olderCursor)}`, {
      schema: chatMessagesPageSchema,
    }).then(
      (page) => {
        prependMessages(page.items.map(toDisplayMessage).reverse());
        setOlderCursor(page.nextCursor);
      },
      (error: unknown) => {
        setLoadError(error);
      },
    );
  };

  const send = () => {
    const payload = composer.take();
    if (payload.content === "") return;
    void run(chatId, payload);
  };

  const regenerate = (messageId: string) => {
    void run(chatId, { regenerate: messageId, ...composer.settings() });
  };

  if (load === "missing") {
    return (
      <EmptyState
        title={t("chat.notFound")}
        action={
          <Link href="/ai" className={buttonStyles()}>
            {t("chat.newChat")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2 ps-2 pe-12 lg:pe-2">
        <h1 className="m-0 truncate font-heading text-xl font-semibold text-primary">
          {chat?.title ?? t("chat.untitled")}
        </h1>
        {chat?.skill ? (
          <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
            {t("chat.skill.active", { skill: skillLabel(chat.skill) })}
          </span>
        ) : null}
      </header>

      {load === "loading" ? (
        <div className="flex flex-1 flex-col gap-4 px-4" aria-busy>
          <Skeleton className="h-12 w-2/3 self-end" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : load === "error" ? (
        <ErrorNotice error={loadError} />
      ) : (
        <MessageList
          messages={turn.messages}
          onRegenerate={regenerate}
          hasOlder={olderCursor !== null}
          onLoadOlder={loadOlder}
          announcement={turn.announcement}
          footer={turn.error ? <ErrorNotice error={turn.error} supportHref={null} /> : null}
        />
      )}

      <div className="mx-auto w-full max-w-3xl">
        <ChatComposerPanel
          composer={composer}
          streaming={turn.streaming}
          onSend={send}
          onStop={turn.stop}
          autoFocus
        />
      </div>
    </div>
  );
}

"use client";

import { t } from "@wasfa/shared/i18n";
import { chatListSchema } from "@wasfa/shared/schemas/chat";
import { buttonStyles, cn, EmptyState, Skeleton } from "@wasfa/ui";
import { MessageSquare } from "lucide-react";
import Link from "next/link";

import { formatRelative } from "../../lib/dates";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { DashboardPanel } from "./dashboard-panel";
import { RECENT_COUNT, RECENT_MIN_HEIGHT, RECENT_ROW } from "./recent-layout";

const PATH = `/ai/chats?limit=${String(RECENT_COUNT)}`;

/** The five latest chats (`GET /ai/chats`), each a link to the conversation. */
export function RecentChats() {
  const list = useResource(PATH, chatListSchema);

  return (
    <DashboardPanel
      id="recent-chats-title"
      title={t("dashboard.chats.title")}
      className={RECENT_MIN_HEIGHT}
      action={
        list.status === "ready" && list.data.items.length > 0 ? (
          <Link href="/ai" className={buttonStyles({ variant: "ghost" })}>
            {t("dashboard.chats.start")}
          </Link>
        ) : undefined
      }
    >
      {list.status === "loading" ? (
        <div role="status" aria-label={t("ui.loading")} className="flex flex-col">
          {Array.from({ length: RECENT_COUNT }, (_, index) => (
            <div key={index} className={cn(RECENT_ROW, "flex-col justify-center gap-2")}>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          ))}
        </div>
      ) : list.status === "error" ? (
        <ErrorNotice error={list.error} onRetry={list.reload} supportHref={null} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          titleAs="h3"
          icon={<MessageSquare />}
          title={t("dashboard.chats.empty")}
          description={t("dashboard.chats.emptyHint")}
          action={
            <Link href="/ai" className={buttonStyles()}>
              {t("dashboard.chats.start")}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {list.data.items.slice(0, RECENT_COUNT).map((chat) => {
            const title = chat.title ?? t("chat.untitled");
            return (
              <li key={chat.id}>
                <Link
                  href={`/ai/${chat.id}`}
                  className={cn(
                    RECENT_ROW,
                    "flex-col justify-center gap-1 rounded-md px-2 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                >
                  <bdi className="truncate text-base font-semibold text-text">{title}</bdi>
                  <span className="text-sm text-text-muted">{formatRelative(chat.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}

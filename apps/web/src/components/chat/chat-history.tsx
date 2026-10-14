"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { chatListSchema, type ChatSummaryView } from "@wasfa/shared/schemas/chat";
import { Button, cn, Dialog, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import {
  Archive,
  ArchiveRestore,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { groupChatsByDate, type ChatGroupKey } from "../../lib/chat-history";
import { CHATS_CHANGED_EVENT } from "../../lib/chat-pending";
import { buildQuery } from "../../lib/use-admin-data";
import { errorMessage, ErrorNotice } from "../error-notice";
import { PopoverMenu } from "../popover-menu";

const PAGE = 30;
const SEARCH_DEBOUNCE_MS = 300;

const GROUP_LABELS: Record<ChatGroupKey, MessageKey> = {
  today: "chat.history.group.today",
  yesterday: "chat.history.group.yesterday",
  week: "chat.history.group.week",
  older: "chat.history.group.older",
};

const menuItem =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

interface ListState {
  items: ChatSummaryView[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
  error?: unknown;
}

export interface ChatHistoryProps {
  /** Called after a chat is opened (the mobile panel closes itself with it). */
  onNavigate?: (() => void) | undefined;
}

/** The chats of the signed-in user, grouped by date, with search, archive, rename and delete. */
export function ChatHistory({ onNavigate }: ChatHistoryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [tick, setTick] = useState(0);
  const [list, setList] = useState<ListState>({ items: [], nextCursor: null, status: "loading" });
  const [renaming, setRenaming] = useState<ChatSummaryView | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ChatSummaryView | null>(null);
  const [busy, setBusy] = useState(false);

  const activeId = /^\/ai\/([^/]+)/.exec(pathname)?.[1];

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  useEffect(() => {
    const reload = () => {
      setTick((current) => current + 1);
    };
    window.addEventListener(CHATS_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener(CHATS_CHANGED_EVENT, reload);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const qs = buildQuery({ limit: String(PAGE), q: query, archived: archived ? "true" : "" });
    api(`/ai/chats?${qs}`, { schema: chatListSchema, signal: controller.signal }).then(
      (page) => {
        setList({ items: page.items, nextCursor: page.nextCursor, status: "ready" });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setList((current) => ({ ...current, status: "error", error }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [query, archived, tick]);

  const loadMore = () => {
    if (!list.nextCursor) return;
    const qs = buildQuery({
      limit: String(PAGE),
      q: query,
      archived: archived ? "true" : "",
      cursor: list.nextCursor,
    });
    api(`/ai/chats?${qs}`, { schema: chatListSchema }).then(
      (page) => {
        setList((current) => ({
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          status: "ready",
        }));
      },
      (error: unknown) => {
        toast({ tone: "error", title: errorMessage(error) });
      },
    );
  };

  const change = useCallback(
    (chat: ChatSummaryView, body: { title?: string; archived?: boolean }) =>
      api(`/ai/chats/${chat.id}`, { method: "PATCH", body }).then(
        () => {
          setTick((current) => current + 1);
        },
        (error: unknown) => {
          toast({ tone: "error", title: errorMessage(error) });
        },
      ),
    [toast],
  );

  const saveRename = () => {
    if (!renaming || title.trim() === "") return;
    setBusy(true);
    void change(renaming, { title: title.trim() }).finally(() => {
      setBusy(false);
      setRenaming(null);
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const chat = deleting;
    setBusy(true);
    api(`/ai/chats/${chat.id}`, { method: "DELETE" })
      .then(
        () => {
          setTick((current) => current + 1);
          if (activeId === chat.id) router.push("/ai");
        },
        (error: unknown) => {
          toast({ tone: "error", title: errorMessage(error) });
        },
      )
      .finally(() => {
        setBusy(false);
        setDeleting(null);
      });
  };

  const groups = groupChatsByDate(list.items, new Date());

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 font-heading text-lg font-semibold text-text">
          {t("chat.history.title")}
        </h2>
        <Link
          href="/ai"
          {...(onNavigate ? { onClick: onNavigate } : {})}
          aria-label={t("chat.newChat")}
          title={t("chat.newChat")}
          className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
        >
          <MessageSquarePlus aria-hidden className="size-5" />
        </Link>
      </div>

      <Input
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        placeholder={t("chat.history.search")}
        aria-label={t("chat.history.search")}
        startIcon={<Search className="size-5" />}
      />

      <button
        type="button"
        aria-pressed={archived}
        onClick={() => {
          setArchived((current) => !current);
        }}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-2 text-sm font-semibold text-text-muted hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Archive aria-hidden className="size-4" />
        {archived ? t("chat.history.showActive") : t("chat.history.showArchived")}
      </button>

      <nav aria-label={t("chat.history.title")} className="min-h-0 flex-1 overflow-y-auto">
        {list.status === "loading" ? (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : list.status === "error" ? (
          <ErrorNotice
            error={list.error}
            supportHref={null}
            onRetry={() => {
              setTick((current) => current + 1);
            }}
          />
        ) : groups.length === 0 ? (
          <p className="m-0 px-2 text-sm text-text-muted">
            {query
              ? t("chat.history.noResults")
              : archived
                ? t("chat.history.archivedEmpty")
                : t("chat.history.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.key} aria-label={t(GROUP_LABELS[group.key])}>
                <h3 className="m-0 mb-1 px-2 text-xs font-semibold text-text-muted">
                  {t(GROUP_LABELS[group.key])}
                </h3>
                <ul className="flex flex-col gap-1">
                  {group.items.map((chat) => {
                    const label = chat.title ?? t("chat.untitled");
                    const active = chat.id === activeId;
                    return (
                      <li key={chat.id} className="flex items-center gap-1">
                        <Link
                          href={`/ai/${chat.id}`}
                          {...(onNavigate ? { onClick: onNavigate } : {})}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 min-w-0 flex-1 items-center rounded-lg px-3 text-base transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                            active
                              ? "bg-primary-soft font-semibold text-primary"
                              : "text-text hover:bg-primary-soft",
                          )}
                        >
                          <span className="truncate">{label}</span>
                        </Link>
                        <PopoverMenu
                          label={t("chat.history.actions", { title: label })}
                          triggerClassName="inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
                          trigger={<MoreHorizontal aria-hidden className="size-5" />}
                        >
                          {(close) => (
                            <ul className="flex flex-col gap-1">
                              <li>
                                <button
                                  type="button"
                                  className={menuItem}
                                  onClick={() => {
                                    close();
                                    setTitle(chat.title ?? "");
                                    setRenaming(chat);
                                  }}
                                >
                                  <Pencil aria-hidden className="size-5 text-neutral-600" />
                                  {t("chat.history.rename")}
                                </button>
                              </li>
                              <li>
                                <button
                                  type="button"
                                  className={menuItem}
                                  onClick={() => {
                                    close();
                                    void change(chat, { archived: !chat.archived });
                                  }}
                                >
                                  {chat.archived ? (
                                    <ArchiveRestore
                                      aria-hidden
                                      className="size-5 text-neutral-600"
                                    />
                                  ) : (
                                    <Archive aria-hidden className="size-5 text-neutral-600" />
                                  )}
                                  {chat.archived
                                    ? t("chat.history.unarchive")
                                    : t("chat.history.archive")}
                                </button>
                              </li>
                              <li>
                                <button
                                  type="button"
                                  className={cn(menuItem, "text-danger hover:text-danger")}
                                  onClick={() => {
                                    close();
                                    setDeleting(chat);
                                  }}
                                >
                                  <Trash2 aria-hidden className="size-5" />
                                  {t("chat.history.delete")}
                                </button>
                              </li>
                            </ul>
                          )}
                        </PopoverMenu>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {list.nextCursor ? (
              <Button variant="ghost" onClick={loadMore}>
                {t("chat.history.loadMore")}
              </Button>
            ) : null}
          </div>
        )}
      </nav>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title={t("chat.rename.title")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRenaming(null);
              }}
            >
              {t("chat.rename.cancel")}
            </Button>
            <Button onClick={saveRename} loading={busy} disabled={title.trim() === ""}>
              {t("chat.rename.save")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveRename();
          }}
        >
          <Field label={t("chat.rename.field")}>
            {(control) => (
              <Input
                {...control}
                value={title}
                maxLength={60}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("chat.delete.title")}
        description={t("chat.delete.body")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleting(null);
              }}
            >
              {t("chat.rename.cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={busy}>
              {t("chat.delete.confirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}

"use client";

import { t } from "@wasfa/shared/i18n";
import { rxListResponseSchema } from "@wasfa/shared/schemas/rx";
import {
  Badge,
  Button,
  buttonStyles,
  Card,
  Dialog,
  EmptyState,
  Input,
  Skeleton,
  useToast,
  type BadgeTone,
} from "@wasfa/ui";
import { ClipboardList, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatDateTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { errorReason, extractErrorRef } from "../../lib/api-error";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { ErrorNotice, errorMessage } from "../error-notice";

import type { RxListResponse } from "@wasfa/shared/schemas/rx";

type HistoryItem = RxListResponse["items"][number];

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_TONES: Record<HistoryItem["status"], BadgeTone> = {
  queued: "neutral",
  processing: "info",
  verifying: "info",
  done: "success",
  failed: "danger",
  refunded: "neutral",
};

/**
 * `/analyze/history`: the person's analyses, newest first, with search by drug name, keyset
 * "show more" and a confirmed delete. A thumbnail is not shown: the list endpoint does not say
 * whether the picture is still kept, and one request per row would cost more than it helps.
 */
export function RxHistory() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [toDelete, setToDelete] = useState<HistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const list = useCursorList("/rx", buildQuery({ q }), rxListResponseSchema);

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/rx/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      toast({ tone: "success", title: t("rx.history.deleted") });
      list.reload();
    } catch (error) {
      const ref = extractErrorRef(error);
      const message =
        errorReason(error) === "in_flight" ? t("rx.history.deleteInFlight") : errorMessage(error);
      toast({
        tone: "error",
        title: t("rx.history.deleteFailed"),
        description: ref ? `${message} (${ref})` : message,
      });
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="search" className="max-w-md">
        <Input
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
          aria-label={t("rx.history.searchLabel")}
          placeholder={t("rx.history.search")}
          startIcon={<Search className="size-5" />}
          autoComplete="off"
          maxLength={100}
        />
      </div>

      {list.status === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : null}

      {list.status === "error" ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}

      {list.status === "ready" && list.items.length === 0 ? (
        q === "" ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("rx.history.empty.title")}
            description={t("rx.history.empty.body")}
            action={
              <Link href="/analyze" className={buttonStyles({})}>
                {t("rx.page.new")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Search />}
            title={t("rx.history.noResults.title")}
            description={t("rx.history.noResults.body")}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setText("");
                }}
              >
                {t("rx.history.clear")}
              </Button>
            }
          />
        )
      ) : null}

      {list.status === "ready" && list.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.items.map((item) => (
            <li key={item.id}>
              <HistoryRow
                item={item}
                onDelete={() => {
                  setToDelete(item);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {list.loadMoreError ? (
        <ErrorNotice error={list.loadMoreError} onRetry={list.loadMore} />
      ) : null}
      {list.nextCursor !== null && list.status === "ready" ? (
        <div>
          <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>
            {t("rx.history.loadMore")}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setToDelete(null);
        }}
        title={t("rx.history.delete.title")}
        description={t("rx.history.delete.body")}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => {
                setToDelete(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => {
                void confirmDelete();
              }}
            >
              {t("rx.history.delete.confirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function HistoryRow({ item, onDelete }: { item: HistoryItem; onDelete: () => void }) {
  const date = formatDateTime(item.createdAt);
  const names = item.itemNames.join("، ");
  return (
    <Card padding="compact" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/analyze/${item.id}`}
            aria-label={t("rx.history.openLabel", { date })}
            className="inline-flex min-h-11 items-center rounded-md text-lg font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            <bdi>{date}</bdi>
          </Link>
          <Badge tone={STATUS_TONES[item.status]}>{t(`rx.status.${item.status}`)}</Badge>
        </div>
        <p className="truncate text-base text-text" title={names}>
          {names === "" ? t("rx.history.noItems") : <bdi>{names}</bdi>}
        </p>
        <p className="text-sm tabular-nums text-text-muted">
          {t("rx.history.items", { count: item.itemCount })} ·{" "}
          {t("rx.history.pages", { count: item.pageCount })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/analyze/${item.id}`} className={buttonStyles({ variant: "secondary" })}>
          {t("rx.history.open")}
        </Link>
        <Button
          variant="ghost"
          aria-label={t("rx.history.deleteLabel", { date })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden className="size-4" />
          {t("rx.history.delete")}
        </Button>
      </div>
    </Card>
  );
}

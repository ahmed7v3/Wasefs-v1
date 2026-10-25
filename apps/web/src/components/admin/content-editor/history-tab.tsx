"use client";

import { t } from "@wasfa/shared/i18n";
import { revisionDetailSchema, type RevisionSummary } from "@wasfa/shared/schemas/content";
import { Badge, Button, Checkbox } from "@wasfa/ui";
import { History, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatDateTime } from "../../../lib/admin-format";
import { revisionListSchema } from "../../../lib/content-editor-schemas";
import { useResource } from "../../../lib/use-admin-data";
import { ConfirmDialog } from "../confirm-dialog";

import { DiffView } from "./diff-view";
import { reviewText } from "./review-tab";

export interface HistoryTabProps {
  itemId: string;
  /** Changes whenever a new revision is created: the list reloads. */
  currentRevisionId: string;
  canRestore: boolean;
  /** Unsaved edits are replaced by a restore: the confirmation says so. */
  dirty: boolean;
  onRestore: (revisionId: string) => Promise<void>;
}

function RevisionCompare({ itemId, ids }: { itemId: string; ids: readonly [string, string] }) {
  const first = useResource(
    `/admin/content/items/${itemId}/revisions/${ids[0]}`,
    revisionDetailSchema,
  );
  const second = useResource(
    `/admin/content/items/${itemId}/revisions/${ids[1]}`,
    revisionDetailSchema,
  );
  if (first.status === "error" || second.status === "error") {
    return (
      <p role="alert" className="text-base text-danger">
        {t("admin.editor.history.compareFailed")}
      </p>
    );
  }
  if (first.status !== "ready" || second.status !== "ready") {
    return (
      <p role="status" className="text-base text-text-muted">
        {t("admin.editor.loading")}
      </p>
    );
  }
  // Older on the left (before), newer on the right (after), whatever order they were ticked in.
  const [older, newer] =
    first.data.number <= second.data.number ? [first.data, second.data] : [second.data, first.data];
  return (
    <DiffView
      before={reviewText(older.payload)}
      after={reviewText(newer.payload)}
      beforeLabel={t("admin.editor.history.revision", { number: older.number })}
      afterLabel={t("admin.editor.history.revision", { number: newer.number })}
    />
  );
}

export function HistoryTab({
  itemId,
  currentRevisionId,
  canRestore,
  dirty,
  onRestore,
}: HistoryTabProps) {
  const list = useResource(`/admin/content/items/${itemId}/revisions`, revisionListSchema);
  const reload = list.reload;
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [restoring, setRestoring] = useState<RevisionSummary | null>(null);

  // A save, restore or workflow step created a revision: refresh the list.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    reload();
  }, [currentRevisionId, reload]);

  if (list.status === "loading") {
    return (
      <p role="status" className="text-base text-text-muted">
        {t("admin.editor.loading")}
      </p>
    );
  }
  if (list.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-base text-danger">
          {t("admin.editor.history.failed")}
        </p>
        <Button variant="secondary" onClick={reload} className="self-start">
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const revisions = [...list.data].sort((a, b) => b.number - a.number);
  const toggle = (id: string, checked: boolean): void => {
    setSelected((current) => {
      if (!checked) return current.filter((candidate) => candidate !== id);
      // Two at most: ticking a third drops the oldest tick.
      return [...current, id].slice(-2);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <History aria-hidden className="size-4" />
        {t("admin.editor.history.hint")}
      </p>
      {revisions.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.editor.history.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              data-revision={revision.number}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-text">
                  {t("admin.editor.history.revision", { number: revision.number })}
                </span>
                <Badge>{t(`admin.editor.history.kind.${revision.kind}`)}</Badge>
                {revision.id === currentRevisionId ? (
                  <Badge tone="info">{t("admin.editor.history.current")}</Badge>
                ) : null}
                {revision.isApproved ? (
                  <Badge tone="success">{t("admin.editor.history.approved")}</Badge>
                ) : null}
                {revision.isPublished ? (
                  <Badge tone="success">{t("admin.editor.history.published")}</Badge>
                ) : null}
              </div>
              <p className="text-sm text-text-muted">
                <bdi>{revision.createdBy.name}</bdi> · {formatDateTime(revision.createdAt)} ·{" "}
                {t("admin.editor.history.stats", revision.diffStats)}
              </p>
              {revision.note ? (
                <p dir="auto" className="whitespace-pre-wrap break-words text-base text-text">
                  {revision.note}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  label={t("admin.editor.history.compare")}
                  checked={selected.includes(revision.id)}
                  onChange={(event) => {
                    toggle(revision.id, event.target.checked);
                  }}
                />
                {canRestore && revision.id !== currentRevisionId ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRestoring(revision);
                    }}
                    aria-label={t("admin.editor.history.restoreNumber", {
                      number: revision.number,
                    })}
                  >
                    <RotateCcw aria-hidden className="size-4" />
                    {t("admin.editor.history.restore")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected.length === 2 ? (
        <section className="flex flex-col gap-2" aria-label={t("admin.editor.history.diffTitle")}>
          <h3 className="text-base font-semibold text-text">
            {t("admin.editor.history.diffTitle")}
          </h3>
          <RevisionCompare itemId={itemId} ids={[selected[0] ?? "", selected[1] ?? ""]} />
        </section>
      ) : selected.length === 1 ? (
        <p role="status" className="text-sm text-text-muted">
          {t("admin.editor.history.pickSecond")}
        </p>
      ) : null}

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
        title={t("admin.editor.history.restoreTitle", { number: restoring?.number ?? 0 })}
        description={t(
          dirty ? "admin.editor.history.restoreDirty" : "admin.editor.history.restoreBody",
        )}
        confirmLabel={t("admin.editor.history.restore")}
        onConfirm={async () => {
          if (restoring) await onRestore(restoring.id);
        }}
      />
    </div>
  );
}

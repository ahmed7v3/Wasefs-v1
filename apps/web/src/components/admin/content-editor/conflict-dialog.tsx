"use client";

import { t } from "@wasfa/shared/i18n";
import { revisionDetailSchema } from "@wasfa/shared/schemas/content";
import { Button, Dialog, useToast } from "@wasfa/ui";
import { useState } from "react";

import { formatRelativeTime } from "../../../lib/admin-format";
import { resolveConflict, type ConflictInfo } from "../../../lib/content-editor/conflict";
import { useResource } from "../../../lib/use-admin-data";

import { DiffView } from "./diff-view";
import { reviewText } from "./review-tab";

import type { ContentPayload } from "@wasfa/shared/schemas/content";

export interface ConflictDialogProps {
  itemId: string;
  conflict: ConflictInfo | null;
  /** The text as the author has it now (unsaved). */
  mine: ContentPayload;
  busy: boolean;
  onOverwrite: () => Promise<void>;
  onReload: () => Promise<void>;
  onClose: () => void;
}

function ConflictBody({
  itemId,
  conflict,
  mine,
  busy,
  onOverwrite,
  onReload,
  onClose,
}: ConflictDialogProps & { conflict: ConflictInfo }) {
  const { toast } = useToast();
  const [showDiff, setShowDiff] = useState(false);
  const theirs = useResource(
    conflict.currentRevisionId
      ? `/admin/content/items/${itemId}/revisions/${conflict.currentRevisionId}`
      : null,
    revisionDetailSchema,
  );
  const overwrite = resolveConflict("overwrite", conflict);

  const who =
    theirs.status === "ready"
      ? t("admin.editor.conflict.by", {
          name: theirs.data.createdBy.name,
          ago: formatRelativeTime(theirs.data.createdAt),
        })
      : t("admin.editor.conflict.generic");

  const copyMine = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(mine.bodyMd);
      toast({ tone: "success", title: t("admin.editor.conflict.copied") });
    } catch {
      // The local mirror still holds the text; say so instead of failing silently.
      toast({ tone: "info", title: t("admin.editor.conflict.copyFailed") });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p role="alert" className="text-base text-text">
        {who}
      </p>
      <p className="text-sm text-text-muted">{t("admin.editor.conflict.explain")}</p>

      {showDiff && theirs.status === "ready" ? (
        <DiffView
          before={reviewText(theirs.data.payload)}
          after={reviewText(mine)}
          beforeLabel={t("admin.editor.conflict.theirs")}
          afterLabel={t("admin.editor.conflict.mine")}
        />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="secondary"
          disabled={theirs.status !== "ready"}
          onClick={() => {
            setShowDiff((current) => !current);
          }}
        >
          {t(showDiff ? "admin.editor.conflict.hideDiff" : "admin.editor.conflict.viewDiff")}
        </Button>
        <Button variant="secondary" onClick={() => void copyMine()}>
          {t("admin.editor.conflict.copy")}
        </Button>
        <Button variant="secondary" loading={busy} onClick={() => void onReload()}>
          {t("admin.editor.conflict.reload")}
        </Button>
        {overwrite.retryWithLockVersion === null ? null : (
          <Button variant="danger" loading={busy} onClick={() => void onOverwrite()}>
            {t("admin.editor.conflict.overwrite")}
          </Button>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t("ui.close")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Somebody saved a newer revision first (`CONTENT_CONFLICT`). Nothing is lost whichever way you go:
 * the unsaved text stays in the local mirror until a save succeeds. The four ways out are the ones in
 * CONTENT-PLATFORM §4.5: look at the difference, overwrite (a new revision on top), copy my text, or
 * load theirs.
 */
export function ConflictDialog(props: ConflictDialogProps) {
  const { conflict, onClose } = props;
  return (
    <Dialog
      open={conflict !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.editor.conflict.title")}
    >
      {conflict ? <ConflictBody {...props} conflict={conflict} /> : null}
    </Dialog>
  );
}

"use client";

import { t } from "@wasfa/shared/i18n";
import {
  revisionDetailSchema,
  type ContentActionBody,
  type ContentItemDetail,
  type ContentPayload,
} from "@wasfa/shared/schemas/content";
import { Badge, Button, Field, Textarea } from "@wasfa/ui";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { formatDateTime } from "../../../lib/admin-format";
import { canReviewNow } from "../../../lib/content-editor/actions";
import { payloadPatch, type EditorDraft } from "../../../lib/content-editor/draft";
import { extractLinks } from "../../../lib/content-editor/markdown-facts";
import { useResource } from "../../../lib/use-admin-data";
import { ReasonDialog } from "../reason-dialog";

import { DiffView } from "./diff-view";
import { GateList } from "./gate-list";

import type { ActionResult } from "../../../lib/content-editor/use-content-editor";
import type { ContentAction } from "@wasfa/shared/content/constants";

export interface ReviewTabProps {
  detail: ContentItemDetail;
  draft: EditorDraft;
  baseline: EditorDraft;
  permissions: readonly string[];
  payloadDirty: boolean;
  busy: ContentAction | null;
  onAction: (
    action: ContentAction,
    body?: Omit<ContentActionBody, "lockVersion">,
    options?: { skipSave?: boolean },
  ) => Promise<ActionResult>;
}

/** The reviewed text of a payload, as one string so the diff covers the title and excerpt too. */
export const reviewText = (payload: ContentPayload): string =>
  [payload.title, payload.excerpt, payload.definition, payload.bodyMd]
    .filter((part) => part.trim() !== "")
    .join("\n\n");

function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

export function ReviewTab({
  detail,
  draft,
  baseline,
  permissions,
  payloadDirty,
  busy,
  onAction,
}: ReviewTabProps) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [note, setNote] = useState("");
  const allowed = detail.allowedActions;
  const reviewer = canReviewNow(permissions, allowed);
  const isReviewer = reviewer.approve || reviewer.requestChanges;
  const canSubmit = allowed.includes("submit");

  const approved = useResource(
    isReviewer && detail.reviewedRevisionId
      ? `/admin/content/items/${detail.id}/revisions/${detail.reviewedRevisionId}`
      : null,
    revisionDetailSchema,
  );
  const before = approved.status === "ready" ? reviewText(approved.data.payload) : "";
  const after = reviewText(draft.payload);

  const sources = useMemo(() => {
    const seen = new Set<string>();
    return extractLinks(draft.payload.bodyMd).filter((link) => {
      if (link.internal || !/^https?:\/\//.test(link.href) || seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });
  }, [draft.payload.bodyMd]);

  const comments = [...detail.comments].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label={t("admin.editor.review.comments")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.review.comments")}</h3>
        {comments.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.editor.review.noComments")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-lg border border-border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <Badge
                    tone={
                      comment.kind === "request_changes"
                        ? "warning"
                        : comment.kind === "approve"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {t(`admin.editor.review.kind.${comment.kind}`)}
                  </Badge>
                  <bdi>{comment.author}</bdi>
                  <span>{formatDateTime(comment.createdAt)}</span>
                </p>
                <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-base text-text">
                  {comment.comment}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canSubmit ? (
        <section className="flex flex-col gap-3" aria-label={t("admin.editor.review.submitTitle")}>
          <h3 className="text-base font-semibold text-text">
            {t("admin.editor.review.submitTitle")}
          </h3>
          <Field
            label={t("admin.editor.review.submitNote")}
            hint={t("admin.editor.review.submitNote.hint")}
          >
            {(control) => (
              <Textarea
                {...control}
                dir="auto"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
          <Button
            loading={busy === "submit"}
            disabled={busy !== null}
            onClick={() => {
              void onAction("submit", note.trim() === "" ? {} : { comment: note.trim() }).then(
                (result) => {
                  if (result === "ok") setNote("");
                },
              );
            }}
            className="self-start"
          >
            {t("admin.editor.action.submit")}
          </Button>
        </section>
      ) : null}

      {isReviewer ? (
        <>
          <section className="flex flex-col gap-3" aria-label={t("admin.editor.review.diffTitle")}>
            <h3 className="text-base font-semibold text-text">
              {t("admin.editor.review.diffTitle")}
            </h3>
            <p className="text-sm text-text-muted">
              {detail.reviewedRevisionId
                ? t("admin.editor.review.diffSinceApproved")
                : t("admin.editor.review.diffFirst")}
            </p>
            {detail.reviewedRevisionId && approved.status === "loading" ? (
              <p role="status" className="text-base text-text-muted">
                {t("admin.editor.loading")}
              </p>
            ) : (
              <DiffView
                before={before}
                after={after}
                beforeLabel={t("admin.editor.review.approvedVersion")}
                afterLabel={t("admin.editor.review.currentVersion")}
              />
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label={t("admin.editor.review.sources")}>
            <h3 className="text-base font-semibold text-text">
              {t("admin.editor.review.sources")}
            </h3>
            {sources.length === 0 ? (
              <p className="text-base text-text-muted">{t("admin.editor.review.noSources")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {sources.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-11 max-w-full items-center gap-2 text-base text-primary underline"
                    >
                      <ExternalLink aria-hidden className="size-4 shrink-0" />
                      <span className="min-w-0 truncate">
                        <bdi>{link.text || hostOf(link.href)}</bdi>
                        {" · "}
                        <bdi dir="ltr">{hostOf(link.href)}</bdi>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-label={t("admin.editor.gates.title")}>
            <h3 className="text-base font-semibold text-text">{t("admin.editor.gates.title")}</h3>
            <GateList gates={detail.gates} />
          </section>

          <section className="flex flex-col gap-3" aria-label={t("admin.editor.review.decide")}>
            <h3 className="text-base font-semibold text-text">{t("admin.editor.review.decide")}</h3>
            {payloadDirty ? (
              <p role="status" className="text-sm text-text-muted">
                {t("admin.editor.review.dirtyHint")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {reviewer.approve ? (
                <>
                  <Button
                    loading={busy === "approve"}
                    disabled={busy !== null || payloadDirty}
                    onClick={() => {
                      void onAction("approve");
                    }}
                  >
                    {t("admin.editor.action.approve")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null || !payloadDirty}
                    onClick={() => {
                      const edits = payloadPatch(baseline.payload, draft.payload);
                      if (edits) void onAction("approve", { edits }, { skipSave: true });
                    }}
                  >
                    {t("admin.editor.action.approveWithEdits")}
                  </Button>
                </>
              ) : null}
              {reviewer.requestChanges ? (
                <Button
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => {
                    setRequestOpen(true);
                  }}
                >
                  {t("admin.editor.action.requestChanges")}
                </Button>
              ) : null}
            </div>
          </section>

          <ReasonDialog
            open={requestOpen}
            onOpenChange={setRequestOpen}
            title={t("admin.editor.action.requestChanges")}
            effect={t("admin.editor.review.requestEffect")}
            confirmLabel={t("admin.editor.action.requestChanges")}
            tone="danger"
            onConfirm={async (reason) => {
              await onAction("request_changes", { comment: reason });
            }}
          />
        </>
      ) : null}
    </div>
  );
}

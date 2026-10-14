"use client";

import { t } from "@wasfa/shared/i18n";
import { EVAL_ITEM_KINDS } from "@wasfa/shared/rx";
import {
  approveCorrectionResponseSchema,
  evalSetListResponseSchema,
  reviewQueueResponseSchema,
  type ReviewQueueItem,
} from "@wasfa/shared/schemas/admin-evals";
import { Button, Card, Dialog, EmptyState, Field, Select, Skeleton, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { evalReasonText } from "../../lib/eval-format";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

const th = "px-3 py-2 text-start text-sm font-semibold text-text-muted";
const td = "px-3 py-2 text-base align-top";

function ApproveDialog({
  item,
  onClose,
  onDone,
}: {
  item: ReviewQueueItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const sets = useResource(item ? "/admin/ai/evals/sets" : null, evalSetListResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [setId, setSetId] = useState("");
  const [kind, setKind] = useState<(typeof EVAL_ITEM_KINDS)[number]>("printed");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const list = sets.status === "ready" ? sets.data.items : [];
  const chosen = setId === "" ? (list[0]?.id ?? "") : setId;

  const submit = () => {
    if (!item || chosen === "") return;
    setSubmitting(true);
    setError(null);
    setFailure(null);
    reauth
      .run(() =>
        api("/admin/ai/evals/review-queue/approve", {
          method: "POST",
          body: { correctionId: item.correctionId, setId: chosen, kind },
          schema: approveCorrectionResponseSchema,
        }),
      )
      .then(
        (done) => {
          setSubmitting(false);
          toast({
            tone: "success",
            title: done.imageCopied
              ? t("admin.evals.review.approved")
              : t("admin.evals.review.approvedNoImage"),
          });
          onDone();
        },
        (problem: unknown) => {
          setSubmitting(false);
          const reason = errorReason(problem);
          if (reason === undefined) setFailure(toApiError(problem));
          else setError(evalReasonText("review", reason));
        },
      );
  };

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("admin.evals.review.approveTitle")}
      description={t("admin.evals.review.approveHint")}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button name="approve" loading={submitting} disabled={chosen === ""} onClick={submit}>
            {t("admin.evals.review.approve")}
          </Button>
        </>
      }
    >
      {item ? (
        <div className="flex flex-col gap-4">
          {sets.status === "loading" ? <Skeleton className="h-20 w-full" /> : null}
          {sets.status === "error" ? (
            <ErrorNotice error={sets.error} onRetry={sets.reload} />
          ) : null}
          {sets.status === "ready" ? (
            <Field label={t("admin.evals.review.set")}>
              {(control) => (
                <Select
                  {...control}
                  name="set"
                  value={chosen}
                  onChange={(event) => {
                    setSetId(event.target.value);
                  }}
                >
                  {list.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name} ({set.key})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t("admin.evals.review.kind")}>
            {(control) => (
              <Select
                {...control}
                name="kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value === "handwritten" ? "handwritten" : "printed");
                }}
              >
                {EVAL_ITEM_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.evals.kind.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-base text-danger">
              {error}
            </p>
          ) : null}
          {failure ? <ErrorNotice error={toApiError(failure)} /> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** User corrections that came with consent for evaluation: approve into a set, or withdraw. */
export function EvalsReviewPanel() {
  const queue = useResource("/admin/ai/evals/review-queue", reviewQueueResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [approving, setApproving] = useState<ReviewQueueItem | null>(null);

  const reject = (item: ReviewQueueItem) => {
    reauth
      .run(() =>
        api("/admin/ai/evals/review-queue/reject", {
          method: "POST",
          body: { correctionId: item.correctionId },
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.evals.review.rejected") });
          queue.reload();
        },
        (error: unknown) => {
          toast({ tone: "error", title: toApiError(error).message });
        },
      );
  };

  if (queue.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (queue.status === "error") return <ErrorNotice error={queue.error} onRetry={queue.reload} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">{t("admin.evals.review.title")}</h2>
        <p className="mt-1 text-base text-text-muted">{t("admin.evals.review.lead")}</p>
      </div>
      {queue.data.items.length === 0 ? (
        <Card elevation="flat">
          <EmptyState title={t("admin.evals.review.empty")} />
        </Card>
      ) : (
        <Card elevation="flat" padding="none" className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse">
            <caption className="sr-only">{t("admin.evals.review.caption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.item")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.field")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.before")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.after")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.image")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.review.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data.items.map((item) => (
                <tr key={item.correctionId} className="border-b border-border/60">
                  <th scope="row" className={`${td} text-start font-semibold`} dir="auto">
                    {item.itemName ?? "—"}
                  </th>
                  <td className={td}>{item.field}</td>
                  <td className={td} dir="auto">
                    {item.before ?? "—"}
                  </td>
                  <td className={td} dir="auto">
                    {item.after ?? "—"}
                  </td>
                  <td className={td}>
                    {item.imageAvailable
                      ? t("admin.evals.review.imageYes")
                      : t("admin.evals.review.imageNo")}
                  </td>
                  <td className={td}>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setApproving(item);
                        }}
                      >
                        {t("admin.evals.review.approve")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          reject(item);
                        }}
                      >
                        {t("admin.evals.review.reject")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ApproveDialog
        item={approving}
        onClose={() => {
          setApproving(null);
        }}
        onDone={() => {
          setApproving(null);
          queue.reload();
        }}
      />
    </div>
  );
}

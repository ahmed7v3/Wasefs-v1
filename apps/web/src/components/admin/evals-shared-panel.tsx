"use client";

import { t } from "@wasfa/shared/i18n";
import { EVAL_ITEM_KINDS } from "@wasfa/shared/rx";
import {
  approveCorrectionResponseSchema,
  evalSetListResponseSchema,
  sharedAnalysisDetailSchema,
  sharedAnalysisListSchema,
  type SharedAnalysisItem,
} from "@wasfa/shared/schemas/admin-evals";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Select,
  Skeleton,
  useToast,
} from "@wasfa/ui";
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

/** One shared analysis: the pictures next to the reading, so the admin can judge it by eye. */
function SharedDialog({
  item,
  onClose,
  onDone,
}: {
  item: SharedAnalysisItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const detail = useResource(
    item ? `/admin/ai/evals/shared/${item.analysisId}` : null,
    sharedAnalysisDetailSchema,
  );
  const sets = useResource(item ? "/admin/ai/evals/sets" : null, evalSetListResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [setId, setSetId] = useState("");
  const [kind, setKind] = useState<(typeof EVAL_ITEM_KINDS)[number]>("handwritten");
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const list = sets.status === "ready" ? sets.data.items : [];
  const chosen = setId === "" ? (list[0]?.id ?? "") : setId;

  const run = (action: "approve" | "dismiss") => {
    if (!item) return;
    setBusy(action);
    setError(null);
    setFailure(null);
    const request =
      action === "approve"
        ? () =>
            api(`/admin/ai/evals/shared/${item.analysisId}/approve`, {
              method: "POST",
              body: { setId: chosen, kind },
              schema: approveCorrectionResponseSchema,
            })
        : () => api(`/admin/ai/evals/shared/${item.analysisId}/dismiss`, { method: "POST" });
    reauth.run(request).then(
      () => {
        setBusy(null);
        toast({
          tone: "success",
          title:
            action === "approve"
              ? t("admin.evals.review.approved")
              : t("admin.evals.shared.dismissed"),
        });
        onDone();
      },
      (problem: unknown) => {
        setBusy(null);
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
      title={t("admin.evals.shared.detailTitle")}
      description={t("admin.evals.shared.detailHint")}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="secondary"
            loading={busy === "dismiss"}
            disabled={busy !== null}
            onClick={() => {
              run("dismiss");
            }}
          >
            {t("admin.evals.shared.dismiss")}
          </Button>
          <Button
            name="approve"
            loading={busy === "approve"}
            disabled={chosen === "" || busy !== null || detail.status !== "ready"}
            onClick={() => {
              run("approve");
            }}
          >
            {t("admin.evals.review.approve")}
          </Button>
        </>
      }
    >
      {detail.status === "loading" ? <Skeleton className="h-48 w-full" /> : null}
      {detail.status === "error" ? (
        <ErrorNotice error={detail.error} onRetry={detail.reload} />
      ) : null}
      {detail.status === "ready" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={detail.data.rating === "good" ? "success" : "warning"}>
              {detail.data.rating === "good" ? t("rx.rating.good") : t("rx.rating.bad")}
            </Badge>
            {detail.data.note ? (
              <p className="text-base text-text" dir="auto">
                {detail.data.note}
              </p>
            ) : null}
          </div>
          {detail.data.images.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {detail.data.images.map((image) => (
                <li key={image.pageNo} className="overflow-hidden rounded-md border border-border">
                  <img
                    src={image.url}
                    alt={t("admin.evals.shared.imageAlt", { n: image.pageNo })}
                    className="max-h-96 w-full object-contain"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-text-muted">{t("admin.evals.shared.noImage")}</p>
          )}
          <table className="w-full border-collapse text-start text-base">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("rx.col.drug")}
                </th>
                <th scope="col" className={th}>
                  {t("rx.col.strength")}
                </th>
                <th scope="col" className={th}>
                  {t("rx.col.form")}
                </th>
                <th scope="col" className={th}>
                  {t("rx.col.frequency")}
                </th>
                <th scope="col" className={th}>
                  {t("rx.col.duration")}
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.data.result.items.map((line, index) => (
                <tr key={index} className="border-b border-border/60">
                  <th scope="row" className={`${td} text-start font-semibold`} dir="auto">
                    {line.name ?? line.rawText}
                  </th>
                  <td className={td} dir="auto">
                    {line.strength ?? "—"}
                  </td>
                  <td className={td} dir="auto">
                    {line.form ?? "—"}
                  </td>
                  <td className={td} dir="auto">
                    {line.frequency ?? "—"}
                  </td>
                  <td className={td} dir="auto">
                    {line.duration ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sets.status === "ready" ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Field label={t("admin.evals.review.kind")}>
                {(control) => (
                  <Select
                    {...control}
                    name="kind"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value === "printed" ? "printed" : "handwritten");
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
            </div>
          ) : null}
          <p className="text-sm text-text-muted">{t("admin.evals.shared.approveNote")}</p>
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

/** Analyses people rated and agreed to share: look at the picture and the answer, then add to a set or dismiss. */
export function EvalsSharedPanel() {
  const queue = useResource("/admin/ai/evals/shared", sharedAnalysisListSchema);
  const [open, setOpen] = useState<SharedAnalysisItem | null>(null);

  if (queue.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (queue.status === "error") return <ErrorNotice error={queue.error} onRetry={queue.reload} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">{t("admin.evals.shared.title")}</h2>
        <p className="mt-1 text-base text-text-muted">{t("admin.evals.shared.lead")}</p>
      </div>
      {queue.data.items.length === 0 ? (
        <Card elevation="flat">
          <EmptyState title={t("admin.evals.shared.empty")} />
        </Card>
      ) : (
        <Card elevation="flat" padding="none" className="overflow-x-auto">
          <table className="w-full min-w-2xl border-collapse">
            <caption className="sr-only">{t("admin.evals.shared.caption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.shared.col.items")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.shared.col.rating")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.shared.col.note")}
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
                <tr key={item.analysisId} className="border-b border-border/60">
                  <th scope="row" className={`${td} text-start font-semibold`} dir="auto">
                    {item.itemNames.join("، ") || "—"}
                    <span className="block text-sm font-normal text-text-muted">
                      {t("rx.result.count", { count: item.itemCount })}
                    </span>
                  </th>
                  <td className={td}>
                    <Badge tone={item.rating === "good" ? "success" : "warning"}>
                      {item.rating === "good" ? t("rx.rating.good") : t("rx.rating.bad")}
                    </Badge>
                  </td>
                  <td className={td} dir="auto">
                    {item.note ?? "—"}
                  </td>
                  <td className={td}>
                    {item.imageAvailable
                      ? t("admin.evals.review.imageYes")
                      : t("admin.evals.review.imageNo")}
                  </td>
                  <td className={td}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpen(item);
                      }}
                    >
                      {t("admin.evals.shared.open")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <SharedDialog
        item={open}
        onClose={() => {
          setOpen(null);
        }}
        onDone={() => {
          setOpen(null);
          queue.reload();
        }}
      />
    </div>
  );
}

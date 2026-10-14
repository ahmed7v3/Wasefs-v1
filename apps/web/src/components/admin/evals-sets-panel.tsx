"use client";

import { t } from "@wasfa/shared/i18n";
import { EVAL_IMPORT_MAX_IMAGES } from "@wasfa/shared/schemas/admin-evals";
import {
  evalImportReportSchema,
  evalImportStartedSchema,
  evalSetListResponseSchema,
  type EvalImportReport,
} from "@wasfa/shared/schemas/admin-evals";
import { Button, Card, EmptyState, Field, Input, Skeleton } from "@wasfa/ui";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { evalReasonText } from "../../lib/eval-format";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

const POLL_MS = 2_000;
const th = "px-3 py-2 text-start text-sm font-semibold text-text-muted";
const td = "px-3 py-2 text-base tabular-nums";

function ImportReport({ report }: { report: EvalImportReport }) {
  if (report.status === "queued" || report.status === "running") {
    return (
      <p role="status" className="text-base">
        {t("admin.evals.import.working")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p
        role="status"
        className={report.status === "failed" ? "text-base text-danger" : "text-base text-success"}
      >
        {report.status === "failed"
          ? t("admin.evals.import.failed", { code: report.errorCode ?? "internal" })
          : t("admin.evals.import.done", { count: formatNumber(report.created) })}
      </p>
      {report.issues.length > 0 ? (
        <div>
          <h3 className="font-semibold">{t("admin.evals.import.issues")}</h3>
          <ul className="mt-1 list-disc ps-6 text-sm text-text-muted" dir="auto">
            {report.issues.map((issue, index) => (
              <li key={`${issue.code}-${String(index)}`}>
                {t("admin.evals.import.issue", {
                  code: issue.code,
                  where:
                    issue.name ??
                    (issue.row === null
                      ? ""
                      : t("admin.evals.import.row", { row: formatNumber(issue.row) })),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const reauth = useReauth();
  const sheet = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [report, setReport] = useState<EvalImportReport | null>(null);

  // The worker does the import; poll its report until it ends.
  useEffect(() => {
    if (batchId === null) return;
    if (report !== null && report.status !== "queued" && report.status !== "running") return;
    const timer = setTimeout(() => {
      api(`/admin/ai/evals/imports/${batchId}`, { schema: evalImportReportSchema }).then(
        (next) => {
          setReport(next);
          if (next.status === "done" || next.status === "failed") onDone();
        },
        (error: unknown) => {
          setFailure(error);
        },
      );
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [batchId, report, onDone]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const sheetFile = sheet.current?.files?.[0];
    const imageFiles = Array.from(images.current?.files ?? []);
    if (sheetFile === undefined || imageFiles.length === 0) {
      setProblem(t("admin.evals.import.pickFiles"));
      return;
    }
    if (imageFiles.length > EVAL_IMPORT_MAX_IMAGES) {
      setProblem(evalReasonText("import", "too_many_images"));
      return;
    }
    setProblem(null);
    setFailure(null);
    setReport(null);
    setSubmitting(true);
    // Text fields first: the API reads the parts in order.
    const body = new FormData();
    body.append("key", key);
    body.append("name", name);
    body.append("sheet", sheetFile);
    for (const file of imageFiles) body.append("images", file);
    reauth
      .run(() =>
        api("/admin/ai/evals/import", { method: "POST", body, schema: evalImportStartedSchema }),
      )
      .then(
        (started) => {
          setSubmitting(false);
          setBatchId(started.id);
        },
        (error: unknown) => {
          setSubmitting(false);
          const reason = errorReason(error);
          if (reason === undefined) setFailure(error);
          else setProblem(evalReasonText("import", reason));
        },
      );
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold">{t("admin.evals.import.title")}</h2>
          <p className="mt-1 text-base text-text-muted">{t("admin.evals.import.lead")}</p>
        </div>
        <Field label={t("admin.evals.import.key")} hint={t("admin.evals.import.keyHint")}>
          {(control) => (
            <Input
              {...control}
              ltr
              name="key"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.evals.import.name")}>
          {(control) => (
            <Input
              {...control}
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.evals.import.sheet")}>
          {(control) => (
            <input
              {...control}
              ref={sheet}
              type="file"
              name="sheet"
              accept=".xlsx"
              className="text-base"
            />
          )}
        </Field>
        <Field label={t("admin.evals.import.images")} hint={t("admin.evals.import.imagesHint")}>
          {(control) => (
            <input
              {...control}
              ref={images}
              type="file"
              name="images"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="text-base"
            />
          )}
        </Field>
        {problem ? (
          <p role="alert" className="text-base text-danger">
            {problem}
          </p>
        ) : null}
        {failure ? <ErrorNotice error={toApiError(failure)} /> : null}
        {report ? (
          <ImportReport report={report} />
        ) : batchId ? (
          <ImportReport
            report={{
              id: batchId,
              status: "queued",
              setId: null,
              created: 0,
              issues: [],
              errorCode: null,
            }}
          />
        ) : null}
        <div>
          <Button type="submit" name="import" loading={submitting}>
            <Upload aria-hidden className="size-5" />
            {t("admin.evals.import.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** The label sets, and the form that adds prescriptions to them. */
export function EvalsSetsPanel() {
  const sets = useResource("/admin/ai/evals/sets", evalSetListResponseSchema);
  const { reload } = sets;

  return (
    <div className="flex flex-col gap-5">
      <ImportForm onDone={reload} />
      <h2 className="font-heading text-xl font-semibold">{t("admin.evals.sets.title")}</h2>
      {sets.status === "loading" ? <Skeleton className="h-32 w-full" /> : null}
      {sets.status === "error" ? <ErrorNotice error={sets.error} onRetry={sets.reload} /> : null}
      {sets.status === "ready" && sets.data.items.length === 0 ? (
        <Card elevation="flat">
          <EmptyState title={t("admin.evals.sets.empty")} />
        </Card>
      ) : null}
      {sets.status === "ready" && sets.data.items.length > 0 ? (
        <Card elevation="flat" padding="none" className="overflow-x-auto">
          <table className="w-full min-w-96 border-collapse">
            <caption className="sr-only">{t("admin.evals.sets.caption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.sets.col.name")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.sets.col.items")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.sets.col.printed")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.sets.col.handwritten")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.sets.col.withoutImage")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sets.data.items.map((set) => (
                <tr key={set.id} className="border-b border-border/60">
                  <th scope="row" className="px-3 py-2 text-start text-base font-semibold">
                    {set.name}{" "}
                    <span className="text-sm font-normal text-text-muted" dir="ltr">
                      ({set.key})
                    </span>
                  </th>
                  <td className={td}>{formatNumber(set.items)}</td>
                  <td className={td}>{formatNumber(set.printed)}</td>
                  <td className={td}>{formatNumber(set.handwritten)}</td>
                  <td className={td}>{formatNumber(set.withoutImage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

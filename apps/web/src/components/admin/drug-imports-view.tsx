"use client";

import { DRUG_SOURCES, type DrugSource } from "@wasfa/shared/ai";
import { DRUG_IMPORT_MAX_BYTES, type DrugImportField } from "@wasfa/shared/drugs";
import { t } from "@wasfa/shared/i18n";
import {
  importListResponseSchema,
  importViewSchema,
  rollbackResponseSchema,
  type ImportReport,
  type ImportRowResult,
  type ImportView,
} from "@wasfa/shared/schemas/admin-drugs";
import { Badge, Button, Card, Field, Select, Skeleton, useToast } from "@wasfa/ui";
import { RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import {
  IMPORT_POLL_MS,
  IMPORT_STATUS_TONES,
  MAPPING_FIELDS,
  draftFrom,
  duplicateFields,
  isRunning,
  mappingFrom,
  presetDraft,
  progressPercent,
  sameMapping,
  type MappingDraft,
} from "../../lib/drug-admin";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice, errorMessage } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";

import type { ApiRequestError } from "../../lib/api-error";

type RowGroup = "preview" | "new" | "updated" | "duplicate" | "invalid";
const GROUPS: readonly RowGroup[] = ["preview", "new", "updated", "duplicate", "invalid"];

const ROW_TONES = {
  new: "success",
  updated: "info",
  duplicate: "neutral",
  invalid: "danger",
} as const;

function StatusBadge({ status }: { status: ImportView["status"] }) {
  return (
    <Badge tone={IMPORT_STATUS_TONES[status]}>{t(`admin.drugs.imports.status.${status}`)}</Badge>
  );
}

// --- Upload ---

function UploadCard({ onUploaded }: { onUploaded: (id: string) => void }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [source, setSource] = useState<DrugSource>("eda");
  const [fileError, setFileError] = useState<string | undefined>();
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const file = input.current?.files?.[0];
    if (!file) {
      setFileError(t("admin.drugs.imports.file.required"));
      return;
    }
    if (file.size > DRUG_IMPORT_MAX_BYTES) {
      setFileError(t("admin.drugs.imports.file.tooLarge"));
      return;
    }
    setFileError(undefined);
    setError(null);
    setSubmitting(true);
    // Text fields first: the API reads the parts in order and the file is the last one.
    const body = new FormData();
    body.append("source", source);
    body.append("file", file);
    reauth
      .run(() => api("/admin/drugs/imports", { method: "POST", body, schema: importViewSchema }))
      .then(
        (created) => {
          setSubmitting(false);
          if (input.current) input.current.value = "";
          toast({ tone: "success", title: t("admin.drugs.imports.started") });
          onUploaded(created.id);
        },
        (failure: unknown) => {
          setSubmitting(false);
          setError(failure as ApiRequestError);
        },
      );
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold">
            {t("admin.drugs.imports.upload.title")}
          </h2>
          <p className="mt-1 text-base text-text-muted">{t("admin.drugs.imports.upload.body")}</p>
        </div>
        <Field label={t("admin.drugs.imports.source")}>
          {(control) => (
            <Select
              {...control}
              value={source}
              onChange={(event) => {
                setSource(event.target.value as DrugSource);
              }}
            >
              {DRUG_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.drugs.imports.source.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("admin.drugs.imports.file")}
          hint={t("admin.drugs.imports.file.hint")}
          error={fileError}
          announceError
        >
          {(control) => (
            <input
              {...control}
              ref={input}
              type="file"
              name="file"
              accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base file:me-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:font-semibold file:text-primary"
              onChange={() => {
                setFileError(undefined);
              }}
            />
          )}
        </Field>
        {error ? <ErrorNotice error={error} /> : null}
        <div>
          <Button type="submit" loading={submitting}>
            <Upload aria-hidden className="size-5" />
            {submitting
              ? t("admin.drugs.imports.uploading")
              : t("admin.drugs.imports.upload.button")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- Report ---

function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "info" | "danger";
}) {
  const colors = {
    neutral: "text-text",
    success: "text-success",
    info: "text-primary",
    danger: "text-danger",
  } as const;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={`font-heading text-2xl font-semibold tabular-nums ${colors[tone]}`}>
        {formatNumber(value)}
      </span>
    </div>
  );
}

function RowsTable({ rows }: { rows: readonly ImportRowResult[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">{t("admin.drugs.imports.view.empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-xl border-collapse text-start text-base">
        <thead className="bg-neutral-100 text-sm text-text-muted">
          <tr>
            {(["number", "status", "name", "strength", "form", "note"] as const).map((column) => (
              <th key={column} scope="col" className="px-3 py-2 text-start font-semibold">
                {t(`admin.drugs.imports.row.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${String(row.row)}-${row.status}`}
              className="border-t border-border align-top"
            >
              <td className="px-3 py-2 tabular-nums">{formatNumber(row.row)}</td>
              <td className="px-3 py-2">
                <Badge tone={ROW_TONES[row.status]}>
                  {t(`admin.drugs.imports.count.${row.status}`)}
                </Badge>
              </td>
              <td className="px-3 py-2">
                <bdi dir="ltr">{row.brandEn || "—"}</bdi>
                {row.brandAr ? <div className="text-sm text-text-muted">{row.brandAr}</div> : null}
              </td>
              <td className="px-3 py-2">
                {row.strength ? <bdi dir="ltr">{row.strength}</bdi> : "—"}
              </td>
              <td className="px-3 py-2">{row.form ?? "—"}</td>
              <td className="px-3 py-2 text-sm text-text-muted">
                {row.reason ? tOr(`admin.drugs.imports.reason.${row.reason}`, row.reason) : null}
                {row.changes.length > 0
                  ? t("admin.drugs.imports.row.changes", {
                      fields: row.changes
                        .map((field) => tOr(`admin.drugs.imports.row.field.${field}`, field))
                        .join("، "),
                    })
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportSection({ report, committed }: { report: ImportReport; committed: boolean }) {
  const [group, setGroup] = useState<RowGroup>("preview");
  const rows = group === "preview" ? report.preview : report.samples[group];
  const reasons = Object.entries(report.reasons);
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          {t(
            committed
              ? "admin.drugs.imports.report.titleCommitted"
              : "admin.drugs.imports.report.title",
          )}
        </h2>
        {committed ? null : (
          <p className="mt-1 text-base text-text-muted">{t("admin.drugs.imports.report.body")}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <CountCard
          label={t("admin.drugs.imports.count.total")}
          value={report.counts.total}
          tone="neutral"
        />
        <CountCard
          label={t("admin.drugs.imports.count.new")}
          value={report.counts.new}
          tone="success"
        />
        <CountCard
          label={t("admin.drugs.imports.count.updated")}
          value={report.counts.updated}
          tone="info"
        />
        <CountCard
          label={t("admin.drugs.imports.count.duplicate")}
          value={report.counts.duplicate}
          tone="neutral"
        />
        <CountCard
          label={t("admin.drugs.imports.count.invalid")}
          value={report.counts.invalid}
          tone="danger"
        />
      </div>
      {reasons.length > 0 ? (
        <div>
          <h3 className="font-heading text-lg font-semibold">
            {t("admin.drugs.imports.reasons.title")}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {reasons.map(([reason, count]) => (
              <li key={reason}>
                <Badge tone="neutral">
                  {tOr(`admin.drugs.imports.reason.${reason}`, reason)}: {formatNumber(count)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div
          role="group"
          aria-label={t("admin.drugs.imports.report.title")}
          className="flex flex-wrap gap-2"
        >
          {GROUPS.map((value) => (
            <Button
              key={value}
              type="button"
              variant={group === value ? "primary" : "secondary"}
              aria-pressed={group === value}
              onClick={() => {
                setGroup(value);
              }}
            >
              {t(`admin.drugs.imports.view.${value}`)}
            </Button>
          ))}
        </div>
        {group === "preview" ? null : (
          <p className="text-sm text-text-muted">{t("admin.drugs.imports.view.sampleNote")}</p>
        )}
        <RowsTable rows={rows} />
      </div>
    </Card>
  );
}

// --- Mapping ---

function MappingSection({
  headers,
  draft,
  source,
  busy,
  onChange,
  onRerun,
}: {
  headers: readonly string[];
  draft: MappingDraft;
  source: DrugSource;
  busy: boolean;
  onChange: (next: MappingDraft) => void;
  onRerun: () => void;
}) {
  const duplicates = duplicateFields(draft);
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          {t("admin.drugs.imports.mapping.title")}
        </h2>
        <p className="mt-1 text-base text-text-muted">{t("admin.drugs.imports.mapping.body")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {headers.map((header) => {
          const field = draft[header] ?? "";
          const clashes = field !== "" && duplicates.includes(field);
          return (
            <Field
              key={header}
              label={<bdi dir="auto">{header}</bdi>}
              error={clashes ? t("admin.drugs.imports.mapping.duplicate") : undefined}
            >
              {(control) => (
                <Select
                  {...control}
                  value={field}
                  onChange={(event) => {
                    onChange({ ...draft, [header]: event.target.value as DrugImportField | "" });
                  }}
                >
                  <option value="">{t("admin.drugs.imports.mapping.ignore")}</option>
                  {MAPPING_FIELDS.map((value) => (
                    <option key={value} value={value}>
                      {t(`admin.drugs.imports.field.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={duplicates.length > 0 || busy} onClick={onRerun}>
          <RefreshCw aria-hidden className="size-5" />
          {t("admin.drugs.imports.mapping.rerun")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange(presetDraft(source, headers));
          }}
        >
          <RotateCcw aria-hidden className="size-5" />
          {t("admin.drugs.imports.mapping.preset")}
        </Button>
      </div>
    </Card>
  );
}

// --- One import ---

function Progress({ view }: { view: ImportView }) {
  const progress = view.progress;
  if (progress === null) return null;
  if (progress.phase === "failed") {
    return (
      <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-4 text-base">
        {tOr(
          `admin.drugs.imports.error.${progress.error ?? "internal"}`,
          t("admin.drugs.imports.error.internal"),
        )}
      </div>
    );
  }
  if (!isRunning(progress)) return null;
  const percent = progressPercent(progress);
  const label = t("admin.drugs.imports.progress.label", {
    mode: t(`admin.drugs.imports.mode.${progress.mode}`),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">
          {label} · {t(`admin.drugs.imports.phase.${progress.phase}`)}
        </span>
        <span className="tabular-nums text-text-muted">
          {t("admin.drugs.imports.progress", {
            done: formatNumber(progress.done),
            total: formatNumber(progress.total),
          })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 overflow-hidden rounded-full bg-neutral-100"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ inlineSize: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}

function ImportPanel({
  id,
  canWrite,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const resource = useResource(`/admin/drugs/imports/${id}`, importViewSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<MappingDraft | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const view = resource.status === "ready" ? resource.data : null;
  const running = isRunning(view?.progress ?? null);
  const { reload } = resource;

  // Poll while a job runs; tell the history when it stops so its counts catch up.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) onChanged();
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(reload, IMPORT_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running, reload, onChanged]);

  if (resource.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={reload} />;
  }
  const current = resource.data;
  const report = current.report;
  const open = current.status !== "committed" && current.status !== "rolled_back";
  const headers = report?.headers ?? [];
  const effective: MappingDraft =
    draft ?? (report ? draftFrom(report.headers, report.mapping) : {});
  const stale = report !== null && !sameMapping(effective, report.mapping);
  const canCommit =
    canWrite &&
    current.status === "dry_run" &&
    report?.mode === "dry_run" &&
    !running &&
    !stale &&
    current.fileAvailable;

  const rerun = () => {
    if (rerunning) return;
    setRerunning(true);
    setActionError(null);
    reauth
      .run(() =>
        api(`/admin/drugs/imports/${id}/dry-run`, {
          method: "POST",
          body: draft === null ? {} : { mapping: mappingFrom(draft) },
          schema: importViewSchema,
        }),
      )
      .then(
        () => {
          setRerunning(false);
          setDraft(null);
          toast({ tone: "success", title: t("admin.drugs.imports.rerunStarted") });
          reload();
        },
        (failure: unknown) => {
          setRerunning(false);
          setActionError(failure);
        },
      );
  };

  const commit = async (): Promise<void> => {
    await api(`/admin/drugs/imports/${id}/commit`, {
      method: "POST",
      body: {},
      schema: importViewSchema,
    });
    toast({ tone: "success", title: t("admin.drugs.imports.commit.started") });
    reload();
    onChanged();
  };

  const rollback = async (): Promise<void> => {
    const result = await api(`/admin/drugs/imports/${id}/rollback`, {
      method: "POST",
      body: {},
      schema: rollbackResponseSchema,
    });
    toast({
      tone: "success",
      title: t("admin.drugs.imports.rollback.done", {
        deleted: formatNumber(result.deletedDrugs),
        untagged: formatNumber(result.untaggedDrugs),
      }),
    });
    reload();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-xl font-semibold">
              <bdi dir="auto">{current.fileName}</bdi>
            </h2>
            <p className="text-sm text-text-muted">
              {t(`admin.drugs.imports.source.${current.source}`)} ·{" "}
              {formatDateTime(current.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} />
            <Button type="button" variant="ghost" onClick={reload}>
              <RefreshCw aria-hidden className="size-5" />
              {t("admin.drugs.imports.refresh")}
            </Button>
          </div>
        </div>
        <Progress view={current} />
        {open && !current.fileAvailable ? (
          <p role="status" className="rounded-md bg-warning-soft p-3 text-base">
            {t("admin.drugs.imports.fileGone")}
          </p>
        ) : null}
        {!canWrite ? (
          <p className="text-sm text-text-muted">{t("admin.drugs.imports.noWrite")}</p>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-danger">
            {errorMessage(actionError)}
          </p>
        ) : null}
      </Card>

      {open && report && canWrite && current.fileAvailable ? (
        <MappingSection
          headers={headers}
          draft={effective}
          source={current.source}
          busy={running || rerunning}
          onChange={setDraft}
          onRerun={rerun}
        />
      ) : null}

      {report ? <ReportSection report={report} committed={report.mode === "commit"} /> : null}

      {canWrite && current.status === "dry_run" ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-xl font-semibold">
            {t("admin.drugs.imports.commit.title")}
          </h2>
          <p className="text-base text-text-muted">{t("admin.drugs.imports.commit.body")}</p>
          {stale ? (
            <p className="text-sm text-warning">{t("admin.drugs.imports.commit.disabledStale")}</p>
          ) : null}
          <div>
            <Button
              type="button"
              disabled={!canCommit}
              onClick={() => {
                setCommitting(true);
              }}
            >
              {t("admin.drugs.imports.commit.button")}
            </Button>
          </div>
          <ConfirmDialog
            open={committing}
            onOpenChange={setCommitting}
            title={t("admin.drugs.imports.commit.confirmTitle", { file: current.fileName })}
            description={t("admin.drugs.imports.commit.confirmBody", {
              new: formatNumber(report?.counts.new ?? 0),
              updated: formatNumber(report?.counts.updated ?? 0),
            })}
            confirmLabel={t("admin.drugs.imports.commit.button")}
            onConfirm={commit}
          />
        </Card>
      ) : null}

      {canWrite && current.status === "committed" ? (
        <Card className="flex flex-col gap-3">
          <p className="text-base text-text-muted">{t("admin.drugs.imports.rollback.body")}</p>
          <div>
            <Button
              type="button"
              variant="danger"
              disabled={running}
              onClick={() => {
                setRollingBack(true);
              }}
            >
              <RotateCcw aria-hidden className="size-5" />
              {t("admin.drugs.imports.rollback.button")}
            </Button>
          </div>
          <ConfirmDialog
            open={rollingBack}
            onOpenChange={setRollingBack}
            title={t("admin.drugs.imports.rollback.title", { file: current.fileName })}
            description={t("admin.drugs.imports.rollback.body")}
            confirmLabel={t("admin.drugs.imports.rollback.confirm")}
            tone="danger"
            onConfirm={rollback}
          />
        </Card>
      ) : null}
    </div>
  );
}

// --- Page ---

export function DrugImportsView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const history = useResource("/admin/drugs/imports", importListResponseSchema);
  const activeId = url.get("import");
  const { reload } = history;

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <UploadCard
          onUploaded={(id) => {
            url.update({ import: id });
            reload();
          }}
        />
      ) : null}

      {activeId === "" ? null : (
        <ImportPanel key={activeId} id={activeId} canWrite={canWrite} onChanged={reload} />
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">{t("admin.drugs.imports.history")}</h2>
        {history.status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {history.status === "error" ? <ErrorNotice error={history.error} onRetry={reload} /> : null}
        {history.status === "ready" && history.data.items.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.drugs.imports.history.empty")}</p>
        ) : null}
        {history.status === "ready" && history.data.items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {history.data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    <bdi dir="auto">{item.fileName}</bdi>
                  </div>
                  <div className="text-sm text-text-muted">
                    {t(`admin.drugs.imports.source.${item.source}`)} ·{" "}
                    {formatDateTime(item.createdAt)}
                    {item.rowsTotal > 0 ? ` · ${formatNumber(item.rowsTotal)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`${t("admin.drugs.imports.history.open")} ${item.fileName}`}
                    onClick={() => {
                      url.update({ import: item.id });
                    }}
                  >
                    {t("admin.drugs.imports.history.open")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}

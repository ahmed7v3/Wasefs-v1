"use client";

import { REDIRECT_REASONS } from "@wasfa/shared/content/constants";
import { t } from "@wasfa/shared/i18n";
import {
  redirectInputSchema,
  redirectListResponseSchema,
  redirectSchema,
  redirectTestResponseSchema,
} from "@wasfa/shared/schemas/content";
import { Badge, Button, Card, Dialog, Field, Input, Select, useToast } from "@wasfa/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError, useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { FilterBar, type FilterField } from "./filter-bar";

import type { ApiRequestError } from "../../lib/api-error";

type RedirectRow = z.output<typeof redirectSchema>;

export interface ContentRedirectsViewProps {
  permissions: readonly string[];
}

/** The «اختبار» panel: where does a path end up, through how many hops, is there a loop. */
export function RedirectTester() {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [result, setResult] = useState<z.output<typeof redirectTestResponseSchema> | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || path.trim() === "") return;
    setBusy(true);
    setError(null);
    setResult(null);
    api(`/admin/content/redirects/test?path=${encodeURIComponent(path.trim())}`, {
      schema: redirectTestResponseSchema,
    }).then(
      (answer) => {
        setBusy(false);
        setResult(answer);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(toApiError(failure));
      },
    );
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold text-text">
        {t("admin.content.redirect.test")}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Field label={t("admin.content.redirect.testPath")} className="min-w-0 flex-1 basis-64">
          {(control) => (
            <Input
              {...control}
              name="testPath"
              ltr
              autoComplete="off"
              placeholder="/blog/old-slug"
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" name="test" variant="secondary" loading={busy}>
          {t("admin.content.redirect.testRun")}
        </Button>
      </form>
      <div aria-live="polite">
        {error ? <ErrorNotice error={error} /> : null}
        {result ? (
          <div className="flex flex-col gap-2 text-base">
            {result.loop ? (
              <Badge tone="danger">{t("admin.content.redirect.loop")}</Badge>
            ) : result.chain.length === 0 ? (
              <Badge tone="neutral">{t("admin.content.redirect.noRedirect")}</Badge>
            ) : (
              <>
                <Badge tone={result.chain.length > 1 ? "warning" : "success"}>
                  {t(
                    result.chain.length > 1
                      ? "admin.content.redirect.chain"
                      : "admin.content.redirect.single",
                    { hops: result.chain.length },
                  )}
                </Badge>
                <p>
                  {t("admin.content.redirect.final")}{" "}
                  <bdi dir="ltr" className="font-semibold">
                    {result.finalPath ?? "—"}
                  </bdi>
                </p>
              </>
            )}
            {result.chain.length > 0 ? (
              <ol
                className="flex flex-col gap-1 text-sm text-text-muted"
                aria-label={t("admin.content.redirect.hops")}
              >
                {[path.trim(), ...result.chain].map((hop, index) => (
                  <li key={`${String(index)}-${hop}`}>
                    <bdi dir="ltr">{hop}</bdi>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function RedirectForm({
  redirect,
  onClose,
  onSaved,
}: {
  redirect: RedirectRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const form = useApiForm({
    schema: redirectInputSchema,
    initial: {
      fromPath: redirect?.fromPath ?? "",
      toPath: redirect?.toPath ?? "",
      reason: redirect?.reason ?? "manual",
    },
    submit: async (values) => {
      await reauth.run(() =>
        api(redirect ? `/admin/content/redirects/${redirect.id}` : "/admin/content/redirects", {
          method: redirect ? "PATCH" : "POST",
          body: values,
          schema: redirectSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.content.redirect.saved") });
      onSaved();
      onClose();
    },
  });
  const announce = form.submitCount > 0;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.content.redirect.from")}
        hint={t("admin.content.redirect.pathHint")}
        required
        error={form.errors["fromPath"]}
        announceError={announce}
      >
        {(control) => <Input {...control} {...form.bind("fromPath")} ltr autoComplete="off" />}
      </Field>
      <Field
        label={t("admin.content.redirect.to")}
        required
        error={form.errors["toPath"]}
        announceError={announce}
      >
        {(control) => <Input {...control} {...form.bind("toPath")} ltr autoComplete="off" />}
      </Field>
      <Field
        label={t("admin.content.redirect.reason")}
        error={form.errors["reason"]}
        announceError={announce}
      >
        {(control) => (
          <Select {...control} {...form.bind("reason")}>
            {REDIRECT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`admin.content.redirect.reason.${reason}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={form.submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function ContentRedirectsView({ permissions }: ContentRedirectsViewProps) {
  const canManage = permissions.includes("content.manage");
  const url = useUrlParams();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ redirect: RedirectRow | null } | null>(null);
  const [deleting, setDeleting] = useState<RedirectRow | null>(null);

  const list = useCursorList(
    "/admin/content/redirects",
    buildQuery({ q: url.get("q") }),
    redirectListResponseSchema,
  );
  const fields: FilterField[] = [
    { kind: "search", name: "q", label: t("admin.content.redirect.search"), ltr: true },
  ];

  const columns: DataTableColumn<RedirectRow>[] = [
    {
      id: "from",
      header: t("admin.content.redirect.from"),
      primary: true,
      cell: (row) => <bdi dir="ltr">{row.fromPath}</bdi>,
    },
    {
      id: "to",
      header: t("admin.content.redirect.to"),
      cell: (row) => <bdi dir="ltr">{row.toPath}</bdi>,
    },
    {
      id: "reason",
      header: t("admin.content.redirect.reason"),
      cell: (row) => t(`admin.content.redirect.reason.${row.reason}`),
    },
    {
      id: "created",
      header: t("admin.content.col.created"),
      cell: (row) => formatShortDate(row.createdAt),
    },
  ];

  const rowActions = canManage
    ? (row: RedirectRow): RowAction[] => [
        {
          id: "edit",
          label: t("admin.content.editVerb"),
          icon: Pencil,
          onSelect: () => {
            setEditing({ redirect: row });
          },
        },
        {
          id: "delete",
          label: t("admin.content.deleteVerb"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setDeleting(row);
          },
        },
      ]
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <RedirectTester />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar fields={fields} />
        {canManage ? (
          <Button
            onClick={() => {
              setEditing({ redirect: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.content.redirect.new")}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.nav.content.redirects")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.fromPath })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={url.get("q") !== ""}
        onClearFilters={() => {
          url.update({ q: null });
        }}
        emptyTitle={t("admin.content.redirect.empty")}
        emptyDescription={t("admin.content.redirect.emptyHint")}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing?.redirect
            ? t("admin.content.redirect.editTitle")
            : t("admin.content.redirect.newTitle")
        }
      >
        {editing ? (
          <RedirectForm
            redirect={editing.redirect}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={list.reload}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("admin.content.redirect.deleteTitle")}
        description={t("admin.content.redirect.deleteBody", { path: deleting?.fromPath ?? "" })}
        confirmLabel={t("admin.content.deleteVerb")}
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/admin/content/redirects/${deleting.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.content.taxonomy.deleted") });
          list.reload();
        }}
      />
    </div>
  );
}

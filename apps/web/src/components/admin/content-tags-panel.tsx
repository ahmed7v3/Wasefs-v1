"use client";

import { t } from "@wasfa/shared/i18n";
import { tagListResponseSchema, tagSchema, type Tag } from "@wasfa/shared/schemas/content";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { tagFormSchema, type TagFormValues } from "../../lib/content-admin-schemas";
import { toApiError, useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { SlugField } from "./content-slug-field";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";

import type { ApiRequestError } from "../../lib/api-error";

function tagInitial(tag: Tag | null): TagFormValues {
  return {
    slugAr: tag?.slugAr ?? "",
    slugEn: tag?.slugEn ?? "",
    nameAr: tag?.nameAr ?? "",
    nameEn: tag?.nameEn ?? "",
    descriptionAr: tag?.descriptionAr ?? "",
    descriptionEn: tag?.descriptionEn ?? "",
  };
}

function TagForm({
  tag,
  onClose,
  onSaved,
}: {
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const form = useApiForm({
    schema: tagFormSchema,
    initial: tagInitial(tag),
    submit: async (values) => {
      await reauth.run(() =>
        api(tag ? `/admin/content/tags/${tag.id}` : "/admin/content/tags", {
          method: tag ? "PATCH" : "POST",
          body: values,
          schema: tagSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.content.taxonomy.saved") });
      onSaved();
      onClose();
    },
  });
  const announce = form.submitCount > 0;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.content.field.nameAr")}
        required
        error={form.errors["nameAr"]}
        announceError={announce}
      >
        {(control) => <Input {...control} {...form.bind("nameAr")} autoComplete="off" />}
      </Field>
      <Field
        label={t("admin.content.field.nameEn")}
        error={form.errors["nameEn"]}
        announceError={announce}
      >
        {(control) => <Input {...control} {...form.bind("nameEn")} ltr autoComplete="off" />}
      </Field>
      <SlugField
        name="slugAr"
        label={t("admin.content.field.slugAr")}
        value={String(form.values.slugAr ?? "")}
        onChange={(value) => {
          form.setValue("slugAr", value);
        }}
        suggestFrom={String(form.values.nameAr)}
        error={form.errors["slugAr"]}
        announceError={announce}
        hint={t("admin.content.tag.slugHint")}
      />
      <SlugField
        name="slugEn"
        label={t("admin.content.field.slugEn")}
        value={String(form.values.slugEn ?? "")}
        onChange={(value) => {
          form.setValue("slugEn", value);
        }}
        suggestFrom={String(form.values.nameEn ?? "")}
        error={form.errors["slugEn"]}
        announceError={announce}
      />
      <Field
        label={t("admin.content.field.descriptionAr")}
        error={form.errors["descriptionAr"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="descriptionAr"
            value={String(form.values.descriptionAr ?? "")}
            onChange={(event) => {
              form.setValue("descriptionAr", event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.content.field.descriptionEn")}
        error={form.errors["descriptionEn"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="descriptionEn"
            value={String(form.values.descriptionEn ?? "")}
            onChange={(event) => {
              form.setValue("descriptionEn", event.target.value);
            }}
          />
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

export interface TagMergeDialogProps {
  open: boolean;
  /** The tag that disappears. */
  from: Tag | null;
  tags: readonly Tag[];
  onClose: () => void;
  onMerged: () => void;
}

function MergeForm({
  from,
  tags,
  onClose,
  onMerged,
}: Omit<TagMergeDialogProps, "open"> & { from: Tag }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [intoId, setIntoId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const into = tags.find((tag) => tag.id === intoId) ?? null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !into) return;
    setBusy(true);
    setError(null);
    reauth
      .run(() =>
        api("/admin/content/tags/merge", {
          method: "POST",
          body: { fromId: from.id, intoId: into.id },
          schema: tagSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.content.tag.merged", { into: into.nameAr }) });
          onMerged();
          onClose();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("admin.content.tag.mergeInto")} required>
        {(control) => (
          <Select
            {...control}
            name="intoId"
            value={intoId}
            onChange={(event) => {
              setIntoId(event.target.value);
            }}
          >
            <option value="">{t("admin.content.tag.mergePick")}</option>
            {tags
              .filter((tag) => tag.id !== from.id)
              .map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.nameAr}
                </option>
              ))}
          </Select>
        )}
      </Field>
      {into ? (
        <p role="status" className="rounded-lg bg-primary-soft px-4 py-3 text-base text-text">
          {t("admin.content.tag.mergeSummary", {
            from: from.nameAr,
            fromCount: from.itemCount,
            into: into.nameAr,
            intoCount: into.itemCount,
          })}
        </p>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="merge" variant="danger" loading={busy} disabled={!into}>
          {t("admin.content.tag.mergeVerb")}
        </Button>
      </div>
    </form>
  );
}

/** Merges one tag into another: its items move over and its old URL redirects to the target. */
export function TagMergeDialog({ open, from, ...rest }: TagMergeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) rest.onClose();
      }}
      title={t("admin.content.tag.mergeTitle", { name: from?.nameAr ?? "" })}
      description={t("admin.content.tag.mergeBody")}
    >
      {open && from ? <MergeForm from={from} {...rest} /> : null}
    </Dialog>
  );
}

export function ContentTagsPanel({ canManage }: { canManage: boolean }) {
  const resource = useResource("/admin/content/tags", tagListResponseSchema);
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ tag: Tag | null } | null>(null);
  const [merging, setMerging] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  const all = useMemo(() => (resource.status === "ready" ? resource.data.items : []), [resource]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(
      (tag) =>
        needle === "" ||
        tag.nameAr.toLowerCase().includes(needle) ||
        (tag.nameEn ?? "").toLowerCase().includes(needle) ||
        (tag.slugAr ?? "").includes(needle) ||
        (tag.slugEn ?? "").includes(needle),
    );
  }, [all, search]);

  const columns: DataTableColumn<Tag>[] = [
    {
      id: "name",
      header: t("admin.content.field.nameAr"),
      primary: true,
      cell: (tag) => tag.nameAr,
    },
    { id: "nameEn", header: t("admin.content.field.nameEn"), cell: (tag) => tag.nameEn ?? "—" },
    {
      id: "slug",
      header: t("admin.content.col.slug"),
      cell: (tag) => (
        <bdi dir="ltr" className="text-start">
          {[tag.slugAr, tag.slugEn].filter(Boolean).join(" · ")}
        </bdi>
      ),
    },
    {
      id: "count",
      header: t("admin.content.col.items"),
      cell: (tag) => tag.itemCount,
    },
  ];

  const rowActions = canManage
    ? (tag: Tag): RowAction[] => [
        {
          id: "edit",
          label: t("admin.content.editVerb"),
          icon: Pencil,
          onSelect: () => {
            setEditing({ tag });
          },
        },
        {
          id: "merge",
          label: t("admin.content.tag.mergeVerb"),
          icon: GitMerge,
          onSelect: () => {
            setMerging(tag);
          },
        },
        {
          id: "delete",
          label: t("admin.content.deleteVerb"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setDeleting(tag);
          },
        },
      ]
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t("admin.content.tag.search")} className="min-w-0 flex-1 basis-56">
          {(control) => (
            <Input
              {...control}
              name="tag-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          )}
        </Field>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing({ tag: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.content.tag.new")}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.content.tab.tags")}
        columns={columns}
        rows={rows}
        rowKey={(tag) => tag.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canManage
            ? (tag) => {
                setEditing({ tag });
              }
            : undefined
        }
        openLabel={(tag) => t("admin.content.edit", { name: tag.nameAr })}
        rowActions={rowActions}
        actionsLabel={(tag) => t("admin.table.actionsFor", { name: tag.nameAr })}
        filtersActive={search.trim() !== ""}
        onClearFilters={() => {
          setSearch("");
        }}
        emptyTitle={t("admin.content.tag.empty")}
        emptyDescription={t("admin.content.tag.emptyHint")}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing?.tag
            ? t("admin.content.tag.editTitle", { name: editing.tag.nameAr })
            : t("admin.content.tag.newTitle")
        }
      >
        {editing ? (
          <TagForm
            tag={editing.tag}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={resource.reload}
          />
        ) : null}
      </Dialog>

      <TagMergeDialog
        open={merging !== null}
        from={merging}
        tags={all}
        onClose={() => {
          setMerging(null);
        }}
        onMerged={resource.reload}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("admin.content.tag.deleteTitle", { name: deleting?.nameAr ?? "" })}
        description={t("admin.content.tag.deleteBody")}
        confirmLabel={t("admin.content.deleteVerb")}
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/admin/content/tags/${deleting.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.content.taxonomy.deleted") });
          resource.reload();
        }}
      />
    </div>
  );
}

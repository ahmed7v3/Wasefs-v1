"use client";

import { CONTENT_LIMITS } from "@wasfa/shared/content/constants";
import { t } from "@wasfa/shared/i18n";
import {
  sitePathSchema,
  type BulkActionInput,
  type ContentOptions,
} from "@wasfa/shared/schemas/content";
import { Button, Checkbox, Dialog, Field, Input, Select } from "@wasfa/ui";
import { Archive, CalendarClock, FolderTree, Send, Tags, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { ApiRequestError } from "../../lib/api-error";
import { zonedLocalToInstant } from "../../lib/content-time";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";

import type { FormEvent, ReactNode } from "react";

/** A bulk request without its ids: the list view adds the selection. */
export type BulkPayload = BulkActionInput extends infer Action
  ? Action extends { ids: unknown }
    ? Omit<Action, "ids">
    : never
  : never;

type DialogId = "category" | "tags" | "reviewer" | "schedule" | "unpublish" | "archive";

interface BulkFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  submitLabel: string;
  canSubmit?: boolean;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}

function BulkForm({
  onOpenChange,
  submitLabel,
  canSubmit = true,
  onSubmit,
  children,
}: Omit<BulkFormDialogProps, "open" | "title" | "description">) {
  const reauth = useReauth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    reauth.run(onSubmit).then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(toApiError(failure));
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {children}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          name="cancel"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="apply" loading={busy} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function BulkFormDialog({ open, onOpenChange, title, description, ...form }: BulkFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {/* Mounted only while open: every opening starts empty. */}
      {open ? <BulkForm onOpenChange={onOpenChange} {...form} /> : null}
    </Dialog>
  );
}

export interface ContentBulkActionsProps {
  count: number;
  options: ContentOptions | null;
  timeZone: string;
  /** Sends the request for the selection; throw to show the error inside the dialog. */
  onRun: (payload: BulkPayload) => Promise<void>;
}

/** Local `YYYY-MM-DDTHH:mm` an hour from now: the default of the schedule dialog's start field. */
function defaultStart(): string {
  const next = new Date(Date.now() + 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(next.getFullYear())}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:00`;
}

function CategoryFields({
  options,
  value,
  onChange,
}: {
  options: ContentOptions | null;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={t("admin.content.bulk.category")} hint={t("admin.content.bulk.categoryHint")}>
      {(control) => (
        <Select
          {...control}
          name="categoryId"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{t("admin.content.bulk.noCategory")}</option>
          {options?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.parentId ? "— " : ""}
              {category.nameAr}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function TagFields({
  options,
  mode,
  onMode,
  selected,
  onToggle,
}: {
  options: ContentOptions | null;
  mode: "add" | "remove" | "replace";
  onMode: (mode: "add" | "remove" | "replace") => void;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (options?.tags ?? []).filter(
      (tag) =>
        needle === "" ||
        tag.nameAr.toLowerCase().includes(needle) ||
        (tag.nameEn ?? "").toLowerCase().includes(needle),
    );
  }, [options, filter]);

  return (
    <>
      <Field label={t("admin.content.bulk.tagsMode")}>
        {(control) => (
          <Select
            {...control}
            name="mode"
            value={mode}
            onChange={(event) => {
              onMode(event.target.value as "add" | "remove" | "replace");
            }}
          >
            <option value="add">{t("admin.content.bulk.tagsMode.add")}</option>
            <option value="remove">{t("admin.content.bulk.tagsMode.remove")}</option>
            <option value="replace">{t("admin.content.bulk.tagsMode.replace")}</option>
          </Select>
        )}
      </Field>
      <Field
        label={t("admin.content.bulk.tagsFilter")}
        hint={t("admin.content.bulk.tagsLimit", { max: CONTENT_LIMITS.tagsPerItemMax })}
      >
        {(control) => (
          <Input
            {...control}
            name="tagFilter"
            type="search"
            autoComplete="off"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        )}
      </Field>
      <fieldset className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border px-3">
        <legend className="px-1 text-sm font-semibold text-text-muted">
          {t("admin.content.bulk.tagsSelected", { count: selected.size })}
        </legend>
        {visible.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">{t("admin.content.bulk.noTags")}</p>
        ) : (
          visible.map((tag) => (
            <Checkbox
              key={tag.id}
              name="tagIds"
              value={tag.id}
              label={tag.nameAr}
              checked={selected.has(tag.id)}
              onChange={() => {
                onToggle(tag.id);
              }}
            />
          ))
        )}
      </fieldset>
    </>
  );
}

/** The bulk action buttons of the list and the dialogs behind them. */
export function ContentBulkActions({ count, options, timeZone, onRun }: ContentBulkActionsProps) {
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [tagMode, setTagMode] = useState<"add" | "remove" | "replace">("add");
  const [tagIds, setTagIds] = useState<ReadonlySet<string>>(new Set());
  const [reviewerId, setReviewerId] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [everyHours, setEveryHours] = useState("24");
  const [redirectTo, setRedirectTo] = useState("");

  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  const openDialog = (id: DialogId) => () => {
    // Every opening starts from its defaults.
    if (id === "category") setCategoryId("");
    if (id === "tags") {
      setTagMode("add");
      setTagIds(new Set());
    }
    if (id === "reviewer") setReviewerId("");
    if (id === "schedule") {
      setStart(defaultStart());
      setEveryHours("24");
    }
    if (id === "archive") setRedirectTo("");
    setDialog(id);
  };

  const startInstant = zonedLocalToInstant(start, timeZone);
  const hours = Number(everyHours);
  const hoursValid = Number.isInteger(hours) && hours >= 1 && hours <= 24 * 14;
  const startValid = startInstant !== null && startInstant.getTime() > Date.now();
  const lastInstant =
    startInstant && hoursValid
      ? new Date(startInstant.getTime() + (count - 1) * hours * 3_600_000)
      : null;

  const redirectValue = redirectTo.trim();
  const redirectValid = redirectValue === "" || sitePathSchema.safeParse(redirectValue).success;

  const actions: { id: DialogId; label: string; icon: typeof Tags; danger?: boolean }[] = [
    { id: "category", label: t("admin.content.bulk.setCategory"), icon: FolderTree },
    { id: "tags", label: t("admin.content.bulk.setTags"), icon: Tags },
    { id: "reviewer", label: t("admin.content.bulk.setReviewer"), icon: UserCheck },
    { id: "schedule", label: t("admin.content.bulk.schedule"), icon: CalendarClock },
    { id: "unpublish", label: t("admin.content.bulk.unpublish"), icon: Send, danger: true },
    { id: "archive", label: t("admin.content.bulk.archive"), icon: Archive, danger: true },
  ];

  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.id}
            variant="secondary"
            name={`bulk-${action.id}`}
            className={action.danger ? "text-danger" : undefined}
            onClick={openDialog(action.id)}
          >
            <Icon aria-hidden className="size-5" />
            {action.label}
          </Button>
        );
      })}

      <BulkFormDialog
        open={dialog === "category"}
        onOpenChange={close}
        title={t("admin.content.bulk.setCategory")}
        description={t("admin.content.bulk.selected", { count })}
        submitLabel={t("admin.content.bulk.apply")}
        onSubmit={() => onRun({ action: "set_category", categoryId: categoryId || null })}
      >
        <CategoryFields options={options} value={categoryId} onChange={setCategoryId} />
      </BulkFormDialog>

      <BulkFormDialog
        open={dialog === "tags"}
        onOpenChange={close}
        title={t("admin.content.bulk.setTags")}
        description={t("admin.content.bulk.selected", { count })}
        submitLabel={t("admin.content.bulk.apply")}
        canSubmit={
          tagIds.size <= CONTENT_LIMITS.tagsPerItemMax && (tagMode === "replace" || tagIds.size > 0)
        }
        onSubmit={() => onRun({ action: "set_tags", mode: tagMode, tagIds: [...tagIds] })}
      >
        <TagFields
          options={options}
          mode={tagMode}
          onMode={setTagMode}
          selected={tagIds}
          onToggle={(id) => {
            setTagIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
        />
      </BulkFormDialog>

      <BulkFormDialog
        open={dialog === "reviewer"}
        onOpenChange={close}
        title={t("admin.content.bulk.setReviewer")}
        description={t("admin.content.bulk.selected", { count })}
        submitLabel={t("admin.content.bulk.apply")}
        onSubmit={() => onRun({ action: "set_reviewer", reviewerId: reviewerId || null })}
      >
        <Field label={t("admin.content.bulk.reviewer")} hint={t("admin.content.bulk.reviewerHint")}>
          {(control) => (
            <Select
              {...control}
              name="reviewerId"
              value={reviewerId}
              onChange={(event) => {
                setReviewerId(event.target.value);
              }}
            >
              <option value="">{t("admin.content.bulk.noReviewer")}</option>
              {options?.reviewers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </BulkFormDialog>

      <BulkFormDialog
        open={dialog === "schedule"}
        onOpenChange={close}
        title={t("admin.content.bulk.schedule")}
        description={t("admin.content.bulk.scheduleHelp", { count })}
        submitLabel={t("admin.content.bulk.scheduleApply")}
        canSubmit={startValid && hoursValid}
        onSubmit={() =>
          onRun({
            action: "schedule_series",
            startAt: (startInstant ?? new Date()).toISOString(),
            everyHours: hours,
          })
        }
      >
        <Field
          label={t("admin.content.bulk.startAt")}
          hint={t("admin.content.bulk.startAtHint", { zone: timeZone })}
          error={startValid ? undefined : t("admin.content.bulk.startAtInvalid")}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="startAt"
              type="datetime-local"
              ltr
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.content.bulk.everyHours")}
          error={hoursValid ? undefined : t("admin.content.bulk.everyHoursInvalid")}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="everyHours"
              type="number"
              inputMode="numeric"
              ltr
              min={1}
              max={24 * 14}
              value={everyHours}
              onChange={(event) => {
                setEveryHours(event.target.value);
              }}
            />
          )}
        </Field>
        {lastInstant ? (
          <p className="text-sm text-text-muted">
            {t("admin.content.bulk.scheduleLast", {
              date: new Intl.DateTimeFormat("ar-EG", {
                numberingSystem: "latn",
                timeZone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(lastInstant),
            })}
          </p>
        ) : null}
      </BulkFormDialog>

      <ConfirmDialog
        open={dialog === "unpublish"}
        onOpenChange={close}
        title={t("admin.content.bulk.unpublishTitle", { count })}
        description={t("admin.content.bulk.unpublishBody")}
        confirmLabel={t("admin.content.bulk.unpublish")}
        tone="danger"
        onConfirm={() => onRun({ action: "unpublish" })}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={close}
        title={t("admin.content.bulk.archiveTitle", { count })}
        description={t("admin.content.bulk.archiveBody")}
        confirmLabel={t("admin.content.bulk.archive")}
        tone="danger"
        onConfirm={() => {
          if (!redirectValid) {
            return Promise.reject(
              new ApiRequestError("VALIDATION_FAILED", t("admin.content.bulk.redirectInvalid")),
            );
          }
          return onRun({
            action: "archive",
            ...(redirectValue === "" ? {} : { redirectTo: redirectValue }),
          });
        }}
      >
        <Field
          label={t("admin.content.bulk.redirectTo")}
          hint={t("admin.content.bulk.redirectToHint")}
          error={redirectValid ? undefined : t("admin.content.bulk.redirectInvalid")}
        >
          {(control) => (
            <Input
              {...control}
              name="redirectTo"
              ltr
              placeholder="/blog/..."
              autoComplete="off"
              value={redirectTo}
              onChange={(event) => {
                setRedirectTo(event.target.value);
              }}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}

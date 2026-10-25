"use client";

import { t } from "@wasfa/shared/i18n";
import { categorySchema, type Category, type ContentOptions } from "@wasfa/shared/schemas/content";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";

import { api } from "../../lib/api-client";
import { categoryFormSchema, type CategoryFormValues } from "../../lib/content-admin-schemas";
import { canHaveParent, parentCandidates } from "../../lib/content-taxonomy";
import { useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { SlugField } from "./content-slug-field";

export interface CategoryDialogProps {
  open: boolean;
  /** `null` creates; a category opens it for editing. */
  category: Category | null;
  categories: readonly Category[];
  options: ContentOptions | null;
  onClose: () => void;
  onSaved: () => void;
}

function initialValues(category: Category | null): CategoryFormValues {
  return {
    parentId: category?.parentId ?? "",
    slugAr: category?.slugAr ?? "",
    slugEn: category?.slugEn ?? "",
    nameAr: category?.nameAr ?? "",
    nameEn: category?.nameEn ?? "",
    descriptionAr: category?.descriptionAr ?? "",
    descriptionEn: category?.descriptionEn ?? "",
    requiresMedicalReview: category?.requiresMedicalReview ?? true,
    defaultReviewerId: category?.defaultReviewerId ?? "",
    seoTitleAr: category?.seoTitleAr ?? "",
    seoDescriptionAr: category?.seoDescriptionAr ?? "",
    seoTitleEn: category?.seoTitleEn ?? "",
    seoDescriptionEn: category?.seoDescriptionEn ?? "",
    sort: category?.sort ?? 0,
  };
}

function CategoryForm({
  category,
  categories,
  options,
  onClose,
  onSaved,
}: Omit<CategoryDialogProps, "open">) {
  const reauth = useReauth();
  const { toast } = useToast();
  const form = useApiForm({
    schema: categoryFormSchema,
    initial: initialValues(category),
    submit: async (values) => {
      await reauth.run(() =>
        api(category ? `/admin/content/categories/${category.id}` : "/admin/content/categories", {
          method: category ? "PATCH" : "POST",
          body: values,
          schema: categorySchema,
        }),
      );
      toast({ tone: "success", title: t("admin.content.taxonomy.saved") });
      onSaved();
      onClose();
    },
  });

  const parents = parentCandidates(categories, category?.id ?? null);
  const parentAllowed = canHaveParent(categories, category?.id ?? null);
  const err = (name: string) => form.errors[name];
  const announce = form.submitCount > 0;
  const text = (name: keyof CategoryFormValues & string, label: string, ltr = false) => (
    <Field label={label} error={err(name)} announceError={announce}>
      {(control) => <Input {...control} {...form.bind(name)} ltr={ltr} autoComplete="off" />}
    </Field>
  );
  const area = (name: keyof CategoryFormValues & string, label: string) => (
    <Field label={label} error={err(name)} announceError={announce}>
      {(control) => (
        <Textarea
          {...control}
          name={name}
          value={String(form.values[name] ?? "")}
          onChange={(event) => {
            form.setValue(name, event.target.value);
          }}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.content.category.parent")}
        hint={parentAllowed ? undefined : t("admin.content.category.parentLocked")}
        error={err("parentId")}
        announceError={announce}
      >
        {(control) => (
          <Select {...control} {...form.bind("parentId")} disabled={!parentAllowed}>
            <option value="">{t("admin.content.category.topLevel")}</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.nameAr}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.content.field.nameAr")}
          required
          error={err("nameAr")}
          announceError={announce}
        >
          {(control) => <Input {...control} {...form.bind("nameAr")} autoComplete="off" />}
        </Field>
        {text("nameEn", t("admin.content.field.nameEn"), true)}
        <SlugField
          name="slugAr"
          label={t("admin.content.field.slugAr")}
          value={String(form.values.slugAr)}
          onChange={(value) => {
            form.setValue("slugAr", value);
          }}
          suggestFrom={String(form.values.nameAr)}
          error={err("slugAr")}
          announceError={announce}
          required
        />
        <SlugField
          name="slugEn"
          label={t("admin.content.field.slugEn")}
          value={String(form.values.slugEn ?? "")}
          onChange={(value) => {
            form.setValue("slugEn", value);
          }}
          suggestFrom={String(form.values.nameEn ?? "")}
          error={err("slugEn")}
          announceError={announce}
        />
      </div>

      {area("descriptionAr", t("admin.content.field.descriptionAr"))}
      {area("descriptionEn", t("admin.content.field.descriptionEn"))}

      <div className="flex flex-col gap-1">
        <Checkbox
          {...form.bindCheckbox("requiresMedicalReview")}
          label={t("admin.content.category.requiresReview")}
        />
        <p className="ps-9 text-sm text-text-muted">
          {t("admin.content.category.requiresReviewHint")}
        </p>
      </div>

      <Field
        label={t("admin.content.category.defaultReviewer")}
        hint={t("admin.content.category.defaultReviewerHint")}
        error={err("defaultReviewerId")}
        announceError={announce}
      >
        {(control) => (
          <Select {...control} {...form.bind("defaultReviewerId")}>
            <option value="">{t("admin.content.category.noReviewer")}</option>
            {options?.reviewers.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-base font-semibold text-text">
          {t("admin.content.category.seo")}
        </legend>
        {text("seoTitleAr", t("admin.content.field.seoTitleAr"))}
        {area("seoDescriptionAr", t("admin.content.field.seoDescriptionAr"))}
        {text("seoTitleEn", t("admin.content.field.seoTitleEn"), true)}
        {area("seoDescriptionEn", t("admin.content.field.seoDescriptionEn"))}
      </fieldset>

      <Field
        label={t("admin.content.category.sort")}
        hint={t("admin.content.category.sortHint")}
        error={err("sort")}
        announceError={announce}
      >
        {(control) => (
          <Input
            {...control}
            {...form.bind("sort")}
            type="number"
            inputMode="numeric"
            ltr
            min={0}
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

export function CategoryDialog({ open, ...form }: CategoryDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.onClose();
      }}
      title={
        form.category
          ? t("admin.content.category.editTitle", { name: form.category.nameAr })
          : t("admin.content.category.newTitle")
      }
    >
      {open ? <CategoryForm {...form} /> : null}
    </Dialog>
  );
}

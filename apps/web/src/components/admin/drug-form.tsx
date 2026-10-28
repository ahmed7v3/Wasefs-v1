"use client";

import { DRUG_STATUSES } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { drugViewSchema, type DrugView } from "@wasfa/shared/schemas/admin-drugs";
import { Button, Field, Input, Select, useToast } from "@wasfa/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import {
  buildDrugPayload,
  draftFromDrug,
  INGREDIENTS_MAX,
  newIngredientRow,
  type DrugDraft,
} from "../../lib/drug-admin";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";

type TextField =
  | "brandEn"
  | "brandAr"
  | "form"
  | "strengthText"
  | "manufacturer"
  | "country"
  | "category"
  | "packText"
  | "unitsCount"
  | "barcode"
  | "price"
  | "oldPrice"
  | "currency";

export interface DrugFormProps {
  /** The entry being edited, or `null` to create one. */
  drug: DrugView | null;
  /** The brand name a new entry starts with (the unmatched reading it is created for). */
  seedBrand?: string | undefined;
  onSaved: (saved: DrugView) => void;
}

/**
 * Every editable field of an entry (docs/MEDICATIONS.md section 7): names, strength, form, pack,
 * category, price in pounds (stored as piastres) and the ingredient list. Editing sends only what
 * changed; the shared create / update schema is the validation, the API enforces the same one.
 */
export function DrugForm({ drug, seedBrand, onSaved }: DrugFormProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<DrugDraft>(() => draftFromDrug(drug, seedBrand));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof DrugDraft>(name: K, value: DrugDraft[K]) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const built = buildDrugPayload(draft, drug);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    if (built.data === null) return;
    setFormError(null);
    setSubmitting(true);
    reauth
      .run(() =>
        api(drug ? `/admin/drugs/${drug.id}` : "/admin/drugs", {
          method: drug ? "PATCH" : "POST",
          body: built.data,
          schema: drugViewSchema,
        }),
      )
      .then(
        (saved) => {
          setSubmitting(false);
          toast({
            tone: "success",
            title: t(drug ? "admin.drugs.edit.saved" : "admin.drugs.create.saved", {
              name: saved.brandEn,
            }),
          });
          onSaved(saved);
        },
        (failure: unknown) => {
          setSubmitting(false);
          setFormError(failure as ApiRequestError);
        },
      );
  };

  const text = (
    name: TextField,
    label: string,
    extra: { hint?: string; ltr?: boolean; errorKey?: string; decimal?: boolean } = {},
  ) => (
    <Field label={label} hint={extra.hint} error={errors[extra.errorKey ?? name]} announceError>
      {(control) => (
        <Input
          {...control}
          name={name}
          value={draft[name]}
          ltr={extra.ltr ?? false}
          inputMode={extra.decimal ? "decimal" : undefined}
          onChange={(event) => {
            set(name, event.target.value);
          }}
        />
      )}
    </Field>
  );

  const updateRow = (key: number, patch: Partial<{ name: string; strength: string }>) => {
    set(
      "ingredients",
      draft.ingredients.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("brandEn", t("admin.drugs.field.brandEn"), { ltr: true })}
        {text("brandAr", t("admin.drugs.field.brandAr"))}
        {text("strengthText", t("admin.drugs.field.strengthText"), {
          hint: t("admin.drugs.field.strengthTextHint"),
          ltr: true,
        })}
        {text("form", t("admin.drugs.field.form"))}
        {text("packText", t("admin.drugs.field.packText"))}
        {text("unitsCount", t("admin.drugs.field.unitsCount"), { ltr: true, decimal: true })}
        {text("category", t("admin.drugs.field.category"))}
        {text("manufacturer", t("admin.drugs.field.manufacturer"))}
        {text("country", t("admin.drugs.field.country"), {
          hint: t("admin.drugs.field.countryHint"),
          ltr: true,
        })}
        {text("barcode", t("admin.drugs.field.barcode"), {
          hint: t("admin.drugs.field.barcodeHint"),
          ltr: true,
        })}
        {text("price", t("admin.drugs.field.price"), {
          hint: t("admin.drugs.field.priceHint"),
          ltr: true,
          decimal: true,
          errorKey: "priceMinor",
        })}
        {text("oldPrice", t("admin.drugs.field.oldPrice"), {
          hint: t("admin.drugs.field.priceHint"),
          ltr: true,
          decimal: true,
          errorKey: "oldPriceMinor",
        })}
        {text("currency", t("admin.drugs.field.currency"), { ltr: true })}
        {drug ? (
          <Field label={t("admin.drugs.field.status")}>
            {(control) => (
              <Select
                {...control}
                value={draft.status}
                onChange={(event) => {
                  set("status", event.target.value as DrugDraft["status"]);
                }}
              >
                {DRUG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`admin.drugs.status.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-2 text-base font-semibold text-text">
          {t("admin.drugs.drawer.ingredients")}
        </legend>
        <p className="text-sm text-text-muted">{t("admin.drugs.field.ingredientsHint")}</p>
        {draft.ingredients.map((row, index) => (
          <div key={row.key} className="grid items-end gap-3 sm:grid-cols-[1fr_10rem_auto]">
            <Field label={t("admin.drugs.field.ingredientName", { n: index + 1 })}>
              {(control) => (
                <Input
                  {...control}
                  name={`ingredient-name-${String(index)}`}
                  ltr
                  value={row.name}
                  onChange={(event) => {
                    updateRow(row.key, { name: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={t("admin.drugs.field.ingredientStrength", { n: index + 1 })}>
              {(control) => (
                <Input
                  {...control}
                  name={`ingredient-strength-${String(index)}`}
                  ltr
                  value={row.strength}
                  onChange={(event) => {
                    updateRow(row.key, { strength: event.target.value });
                  }}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="ghost"
              aria-label={t("admin.drugs.field.ingredientRemove", { n: index + 1 })}
              onClick={() => {
                set(
                  "ingredients",
                  draft.ingredients.filter((other) => other.key !== row.key),
                );
              }}
            >
              <Trash2 aria-hidden className="size-5" />
            </Button>
          </div>
        ))}
        {errors["ingredients"] ? (
          <p role="alert" className="text-sm text-danger">
            {errors["ingredients"]}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={draft.ingredients.length >= INGREDIENTS_MAX}
            onClick={() => {
              set("ingredients", [...draft.ingredients, newIngredientRow()]);
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.drugs.field.ingredientAdd")}
          </Button>
        </div>
      </fieldset>

      {formError ? <ErrorNotice error={formError} /> : null}
      <div>
        <Button type="submit" loading={submitting}>
          {t(drug ? "admin.drugs.edit.save" : "admin.drugs.create.save")}
        </Button>
      </div>
    </form>
  );
}

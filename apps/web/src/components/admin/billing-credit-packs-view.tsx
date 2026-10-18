"use client";

import { t } from "@wasfa/shared/i18n";
import { fromMinor, toMinor } from "@wasfa/shared/money";
import {
  adminCreditPackCreateSchema,
  adminCreditPackPatchSchema,
} from "@wasfa/shared/schemas/admin-billing-console";
import { Badge, Button, Card, Checkbox, Field, Input, moneyText, useToast } from "@wasfa/ui";
import { Package, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { creditPackListSchema, type CreditPackView } from "../../lib/admin-billing-schemas";
import { api } from "../../lib/api-client";
import { DEFAULT_CURRENCIES } from "../../lib/price-matrix";
import { useResource } from "../../lib/use-admin-data";

import { EmptyHint } from "./empty-hint";
import { ReasonDialog } from "./reason-dialog";
import { ResourceBoundary } from "./resource-boundary";

interface PackForm {
  key: string;
  nameAr: string;
  nameEn: string;
  credits: string;
  bonusCredits: string;
  validMonths: string;
  sort: string;
  active: boolean;
  prices: Record<string, string>;
}

const createdSchema = z.object({ id: z.string() });

function formFor(pack: CreditPackView | null): PackForm {
  const prices: Record<string, string> = {};
  for (const currency of DEFAULT_CURRENCIES) prices[currency] = "";
  for (const price of pack?.prices ?? []) {
    prices[price.currency] =
      price.amountMinor === null ? "" : fromMinor(price.amountMinor, price.currency);
  }
  return {
    key: pack?.key ?? "",
    nameAr: pack?.nameAr ?? "",
    nameEn: pack?.nameEn ?? "",
    credits: pack ? String(pack.credits) : "",
    bonusCredits: pack ? String(pack.bonusCredits) : "0",
    validMonths: pack ? String(pack.validMonths) : "12",
    sort: pack ? String(pack.sort) : "0",
    active: pack?.active ?? true,
    prices,
  };
}

/** Details as the API body, or null when a number is not an integer or a schema rule fails. */
export function packBody(form: PackForm, creating: boolean): Record<string, unknown> | null {
  const numbers = {
    credits: Number(form.credits),
    bonusCredits: Number(form.bonusCredits),
    validMonths: Number(form.validMonths),
    sort: Number(form.sort),
  };
  if (!Object.values(numbers).every((value) => Number.isInteger(value))) return null;
  const body = {
    nameAr: form.nameAr.trim(),
    nameEn: form.nameEn.trim(),
    ...numbers,
    active: form.active,
    ...(creating ? { key: form.key.trim() } : {}),
  };
  const parsed = (creating ? adminCreditPackCreateSchema : adminCreditPackPatchSchema).safeParse(
    body,
  );
  return parsed.success ? body : null;
}

/** Price cells to send: every filled cell as minor units, every emptied stored cell as `null`. */
export function packPrices(
  form: PackForm,
  pack: CreditPackView | null,
): { currency: string; amountMinor: number | null }[] | null {
  const prices: { currency: string; amountMinor: number | null }[] = [];
  for (const [currency, text] of Object.entries(form.prices)) {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (pack?.prices.some((price) => price.currency === currency && price.amountMinor !== null)) {
        prices.push({ currency, amountMinor: null });
      }
      continue;
    }
    try {
      const amountMinor = toMinor(trimmed, currency);
      if (amountMinor < 0) return null;
      prices.push({ currency, amountMinor });
    } catch {
      return null;
    }
  }
  return prices;
}

function PackDialog({
  pack,
  open,
  onOpenChange,
  onSaved,
}: {
  pack: CreditPackView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const creating = pack === null;
  const [form, setForm] = useState<PackForm>(() => formFor(pack));
  const [extra, setExtra] = useState("");
  const body = packBody(form, creating);
  const prices = packPrices(form, pack);
  const egp = prices?.find((price) => price.currency === "EGP")?.amountMinor ?? null;
  const patch = (change: Partial<PackForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const text = (
    name: "key" | "nameAr" | "nameEn" | "credits" | "bonusCredits" | "validMonths" | "sort",
    label: string,
    ltr = false,
  ) => (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={ltr}
          disabled={name === "key" && !creating}
          value={form[name]}
          onChange={(event) => {
            patch({ [name]: event.target.value } as Partial<PackForm>);
          }}
        />
      )}
    </Field>
  );

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        creating
          ? t("admin.pricing.packs.createTitle")
          : t("admin.pricing.packs.editTitle", { name: pack.nameAr })
      }
      effect={t("admin.pricing.packs.effect")}
      confirmLabel={t("admin.pricing.packs.save")}
      canSubmit={body !== null && prices !== null && (!creating || form.key.trim() !== "")}
      onConfirm={async (reason) => {
        if (body === null || prices === null) return;
        let id = pack?.id;
        if (creating) {
          const created = await api("/admin/billing/credit-packs", {
            method: "POST",
            body,
            schema: createdSchema,
          });
          id = created.id;
        } else {
          await api(`/admin/billing/credit-packs/${pack.id}`, { method: "PATCH", body });
        }
        if (id && prices.length > 0) {
          await api(`/admin/billing/credit-packs/${id}/prices`, {
            method: "PUT",
            body: { reason, prices },
          });
        }
        toast({ tone: "success", title: t("admin.pricing.packs.saved", { name: form.nameAr }) });
        onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {creating ? text("key", t("admin.pricing.packs.key"), true) : null}
        {text("nameAr", t("admin.pricing.packs.nameAr"))}
        {text("nameEn", t("admin.pricing.packs.nameEn"), true)}
        {text("credits", t("admin.pricing.packs.credits"), true)}
        {text("bonusCredits", t("admin.pricing.packs.bonus"), true)}
        {text("validMonths", t("admin.pricing.packs.valid"), true)}
        {text("sort", t("admin.pricing.packs.sort"), true)}
      </div>
      <Checkbox
        label={t("admin.pricing.packs.active")}
        checked={form.active}
        onChange={(event) => {
          patch({ active: event.target.checked });
        }}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">{t("admin.pricing.packs.prices")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.keys(form.prices).map((currency) => (
            <Field
              key={currency}
              label={`${t("admin.pricing.packs.price")} (${currency})`}
              error={prices === null ? t("admin.pricing.matrix.invalid") : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`price-${currency}`}
                  ltr
                  inputMode="decimal"
                  placeholder={t("admin.pricing.matrix.notOffered")}
                  value={form.prices[currency] ?? ""}
                  onChange={(event) => {
                    patch({ prices: { ...form.prices, [currency]: event.target.value } });
                  }}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("admin.pricing.matrix.addCurrency")}
            <Input
              name="new-currency"
              ltr
              maxLength={3}
              className="w-28"
              value={extra}
              onChange={(event) => {
                setExtra(event.target.value.toUpperCase());
              }}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!/^[A-Z]{3}$/.test(extra) || extra in form.prices}
            onClick={() => {
              patch({ prices: { ...form.prices, [extra]: "" } });
              setExtra("");
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.pricing.matrix.add")}
          </Button>
        </div>
      </fieldset>
      <Card
        elevation="flat"
        padding="compact"
        className="flex flex-col gap-1"
        aria-label={t("admin.pricing.packs.preview")}
      >
        <p className="text-sm text-text-muted">{t("admin.pricing.packs.preview")}</p>
        <p className="font-heading text-lg font-semibold">
          {form.nameAr || t("admin.pricing.preview.unnamed")}
        </p>
        <p className="text-base">
          {t("admin.pricing.packs.previewCredits", {
            credits: Number(form.credits) || 0,
            bonus: Number(form.bonusCredits) || 0,
          })}
        </p>
        {egp !== null ? (
          <p className="text-base font-semibold tabular-nums">{moneyText(egp, "EGP")}</p>
        ) : null}
      </Card>
    </ReasonDialog>
  );
}

/** `/admin/billing/credit-packs`: the packs customers can buy, with a price per currency. */
export function BillingCreditPacksView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/billing/credit-packs", creditPackListSchema);
  const [editing, setEditing] = useState<{ pack: CreditPackView | null } | null>(null);
  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <Button
          name="new-pack"
          className="self-start"
          onClick={() => {
            setEditing({ pack: null });
          }}
        >
          <Plus aria-hidden className="size-5" />
          {t("admin.pricing.packs.new")}
        </Button>
      ) : null}
      <ResourceBoundary resource={resource}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyHint
              icon={<Package />}
              title={t("admin.pricing.packs.empty")}
              hint={t("admin.pricing.packs.emptyHint")}
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((pack) => (
                <li key={pack.id}>
                  <Card elevation="flat" className="flex h-full flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-heading text-lg font-semibold">{pack.nameAr}</h2>
                      <Badge tone={pack.active ? "success" : "neutral"}>
                        {pack.active ? t("admin.pricing.packs.on") : t("admin.pricing.packs.off")}
                      </Badge>
                    </div>
                    <p className="text-base">
                      {t("admin.pricing.packs.previewCredits", {
                        credits: pack.credits,
                        bonus: pack.bonusCredits,
                      })}
                    </p>
                    <p className="text-sm text-text-muted">
                      {t("admin.pricing.packs.validity", { months: pack.validMonths })}
                    </p>
                    <ul className="flex flex-col gap-1 text-base tabular-nums">
                      {pack.prices
                        .filter((price) => price.amountMinor !== null)
                        .map((price) => (
                          <li key={price.currency}>
                            {moneyText(price.amountMinor ?? 0, price.currency)}
                          </li>
                        ))}
                    </ul>
                    {canWrite ? (
                      <Button
                        variant="secondary"
                        name={`edit-${pack.key}`}
                        className="mt-auto self-start"
                        onClick={() => {
                          setEditing({ pack });
                        }}
                      >
                        <Pencil aria-hidden className="size-5" />
                        {t("admin.pricing.packs.edit")}
                      </Button>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceBoundary>
      {editing ? (
        <PackDialog
          key={editing.pack?.id ?? "new"}
          pack={editing.pack}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={resource.reload}
        />
      ) : null}
    </div>
  );
}

"use client";

import { DISCOUNT_KINDS } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { bulkCouponResponseSchema } from "@wasfa/shared/schemas/billing";
import { Button, Checkbox, Dialog, Field, Input, Select } from "@wasfa/ui";
import { Download, Loader } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { type AdminPlan } from "../../lib/admin-billing-schemas";
import { api } from "../../lib/api-client";
import { downloadCsv } from "../../lib/csv-download";
import { toApiError } from "../../lib/forms";
import {
  bulkBody,
  couponBody,
  emptyCouponExtra,
  emptyPromotionForm,
  type CouponExtra,
  type PromotionForm,
} from "../../lib/promotion-form";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { UserPicker, type PickedUser } from "./user-picker";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

export interface CouponDialogProps {
  open: boolean;
  mode: "single" | "bulk";
  plans: readonly AdminPlan[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface BulkDone {
  batch: string;
  count: number;
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

function CouponForm({ mode, plans, onOpenChange, onCreated }: Omit<CouponDialogProps, "open">) {
  const reauth = useReauth();
  const [form, setForm] = useState<PromotionForm>(emptyPromotionForm);
  const [extra, setExtra] = useState<CouponExtra>(emptyCouponExtra);
  const [user, setUser] = useState<PickedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<BulkDone | null>(null);
  const [downloading, setDownloading] = useState(false);

  const patch = (change: Partial<PromotionForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const patchExtra = (change: Partial<CouponExtra>) => {
    setExtra((current) => ({ ...current, ...change }));
  };
  const effectiveExtra: CouponExtra = { ...extra, targetUserId: user?.id ?? null };
  const single = couponBody(form, effectiveExtra);
  const bulk = bulkBody(form, effectiveExtra);
  const built = mode === "single" ? single : bulk;
  const failing = built.ok ? [] : built.errors;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (busy || !built.ok) return;
    setBusy(true);
    setError(null);
    if (mode === "single" && single.ok) {
      const body = single.body;
      api("/admin/billing/coupons", { method: "POST", body }).then(
        () => {
          setBusy(false);
          onCreated();
          onOpenChange(false);
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
    } else if (bulk.ok) {
      const body = bulk.body;
      reauth
        .run(() =>
          api("/admin/billing/coupons/bulk", {
            method: "POST",
            body,
            schema: bulkCouponResponseSchema,
          }),
        )
        .then(
          (result) => {
            setBusy(false);
            setDone(result);
            onCreated();
          },
          (failure: unknown) => {
            setBusy(false);
            setError(toApiError(failure));
          },
        );
    }
  };

  const field = (
    name: keyof PromotionForm,
    label: string,
    options: { ltr?: boolean; type?: string; hint?: string } = {},
  ) => (
    <Field
      label={label}
      hint={options.hint}
      error={touched && failing.includes(name) ? t("admin.pricing.promo.fieldInvalid") : undefined}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={options.ltr}
          type={options.type ?? "text"}
          value={String(form[name])}
          onChange={(event) => {
            patch({ [name]: event.target.value } as Partial<PromotionForm>);
          }}
        />
      )}
    </Field>
  );

  if (done) {
    return (
      <div className="flex flex-col gap-4" data-testid="bulk-done">
        <p role="status" className="text-base">
          {t("admin.revenue.coupons.bulkDone", { count: done.count, batch: done.batch })}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            name="download-csv"
            loading={downloading}
            onClick={() => {
              setDownloading(true);
              downloadCsv(
                `/admin/billing/coupons/batches/${done.batch}/export`,
                `coupons-${done.batch}.csv`,
              ).then(
                () => {
                  setDownloading(false);
                },
                (failure: unknown) => {
                  setDownloading(false);
                  setError(toApiError(failure));
                },
              );
            }}
          >
            <Download aria-hidden className="size-5" />
            {t("admin.revenue.coupons.downloadCsv")}
          </Button>
          <Link
            href={`/admin/billing/coupons?batch=${done.batch}`}
            onClick={() => {
              onOpenChange(false);
            }}
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-base font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("admin.revenue.coupons.openBatch")}
          </Link>
        </div>
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {busy && mode === "bulk" ? (
        <div
          role="progressbar"
          aria-busy="true"
          aria-label={t("admin.revenue.coupons.creating")}
          className="flex items-center gap-2 text-base"
        >
          <Loader aria-hidden className="size-5 animate-spin" />
          {t("admin.revenue.coupons.creating")}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", t("admin.pricing.promo.name"))}
        {mode === "single" ? (
          <Field
            label={t("admin.revenue.coupons.code")}
            hint={t("admin.revenue.coupons.codeHint")}
            error={
              touched && failing.includes("code")
                ? t("admin.pricing.promo.fieldInvalid")
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                name="code"
                ltr
                autoComplete="off"
                value={extra.code}
                onChange={(event) => {
                  patchExtra({ code: event.target.value.toUpperCase() });
                }}
              />
            )}
          </Field>
        ) : (
          <>
            <Field
              label={t("admin.revenue.coupons.count")}
              error={
                touched && failing.includes("count")
                  ? t("admin.pricing.promo.fieldInvalid")
                  : undefined
              }
            >
              {(control) => (
                <Input
                  {...control}
                  name="count"
                  ltr
                  inputMode="numeric"
                  value={extra.count}
                  onChange={(event) => {
                    patchExtra({ count: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={t("admin.revenue.coupons.prefix")}>
              {(control) => (
                <Input
                  {...control}
                  name="prefix"
                  ltr
                  autoComplete="off"
                  value={extra.prefix}
                  onChange={(event) => {
                    patchExtra({ prefix: event.target.value.toUpperCase() });
                  }}
                />
              )}
            </Field>
            <Field label={t("admin.revenue.coupons.length")}>
              {(control) => (
                <Input
                  {...control}
                  name="length"
                  ltr
                  inputMode="numeric"
                  value={extra.length}
                  onChange={(event) => {
                    patchExtra({ length: event.target.value });
                  }}
                />
              )}
            </Field>
          </>
        )}
        {field("titleAr", t("admin.pricing.promo.titleAr"))}
        {field("titleEn", t("admin.pricing.promo.titleEn"), { ltr: true })}
        <Field label={t("admin.pricing.promo.kind")}>
          {(control) => (
            <Select
              {...control}
              name="kind"
              value={form.kind}
              onChange={(event) => {
                const kind = DISCOUNT_KINDS.find((entry) => entry === event.target.value);
                if (kind) patch({ kind });
              }}
            >
              {DISCOUNT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`admin.revenue.coupons.kind.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {field("value", t(`admin.revenue.coupons.value.${form.kind}`), { ltr: true })}
        {form.kind === "fixed"
          ? field("currency", t("admin.pricing.promo.currency"), { ltr: true })
          : null}
        {field("maxRedemptions", t("admin.pricing.promo.max"), { ltr: true })}
        {field("perOwnerLimit", t("admin.pricing.promo.perOwner"), { ltr: true })}
        {field("startsAt", t("admin.pricing.promo.startsAt"), {
          ltr: true,
          type: "datetime-local",
        })}
        {field("endsAt", t("admin.pricing.promo.endsAt"), { ltr: true, type: "datetime-local" })}
        <Field label={t("admin.revenue.coupons.campaign")}>
          {(control) => (
            <Input
              {...control}
              name="campaign"
              autoComplete="off"
              value={extra.campaign}
              onChange={(event) => {
                patchExtra({ campaign: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">{t("admin.pricing.promo.plans")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {plans.map((plan) => (
            <Checkbox
              key={plan.id}
              label={plan.nameAr}
              checked={form.planIds.includes(plan.id)}
              onChange={() => {
                patch({ planIds: toggle(form.planIds, plan.id) });
              }}
            />
          ))}
        </div>
      </fieldset>
      <Checkbox
        label={t("admin.pricing.promo.newOnly")}
        checked={form.newCustomersOnly}
        onChange={(event) => {
          patch({ newCustomersOnly: event.target.checked });
        }}
      />
      {mode === "single" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <h3 className="font-heading text-base font-semibold">
            {t("admin.revenue.coupons.assign")}
          </h3>
          <p className="text-sm text-text-muted">{t("admin.revenue.coupons.assignHint")}</p>
          <UserPicker
            label={t("admin.revenue.coupons.assignUser")}
            value={user}
            onChange={setUser}
          />
          <Field
            label={t("admin.revenue.coupons.assignOrg")}
            error={
              touched && failing.includes("targetOrgId")
                ? t("admin.revenue.coupons.assignBoth")
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                name="targetOrgId"
                ltr
                autoComplete="off"
                value={extra.targetOrgId}
                onChange={(event) => {
                  patchExtra({ targetOrgId: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
      ) : null}
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
        <Button type="submit" name="create-coupon" loading={busy}>
          {mode === "single"
            ? t("admin.revenue.coupons.createSingle")
            : t("admin.revenue.coupons.createBulk")}
        </Button>
      </div>
    </form>
  );
}

/** Create one coupon, or a batch (count, prefix, length) that ends in a CSV download. */
export function CouponDialog({ open, mode, ...rest }: CouponDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={rest.onOpenChange}
      title={
        mode === "single"
          ? t("admin.revenue.coupons.singleTitle")
          : t("admin.revenue.coupons.bulkTitle")
      }
      className="sm:max-w-3xl"
    >
      {open ? <CouponForm mode={mode} {...rest} /> : null}
    </Dialog>
  );
}

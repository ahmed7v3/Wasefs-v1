"use client";

import {
  AD_DEVICES,
  NEVER_SERVE_CLASSES,
  SERVABLE_PAGE_CLASSES,
  adminPlacementListSchema,
  adminPlacementSchema,
  updatePlacementSchema,
  type AdDevice,
  type AdminPlacement,
  type PageClass,
} from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Checkbox, Field, Input, useToast } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber, tOr } from "../../lib/admin-format";
import { aspectOf, sizeLabel } from "../../lib/ads-admin";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { Code } from "./badges";
import { DataTable, type DataTableColumn } from "./data-table";
import { RecordDrawer, useOpenRecord } from "./record-drawer";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

const BOTTOM_BANNER_KEY = "global.bottom_banner";

/** The box a placement reserves, drawn to the scale of its aspect ratio, for desktop and phone. */
export function PlacementPreview({
  sizeDesktop,
  sizeMobile,
  format,
}: {
  sizeDesktop: string;
  sizeMobile: string;
  format: string;
}) {
  const label = t("ads.label");
  const boxes = [
    { id: "desktop", title: t("admin.ads.device.desktop"), size: sizeDesktop, width: "w-full" },
    { id: "mobile", title: t("admin.ads.device.mobile"), size: sizeMobile, width: "w-2/5" },
  ] as const;
  return (
    <div className="flex flex-wrap items-end gap-4" data-testid="placement-preview">
      {boxes.map((box) => (
        <figure key={box.id} className={`flex min-w-24 flex-col gap-1 ${box.width}`}>
          <figcaption className="text-sm text-text-muted">{box.title}</figcaption>
          <p className="text-xs text-text-muted">{label}</p>
          <div
            data-testid={`preview-${box.id}`}
            style={{ aspectRatio: aspectOf(box.size) }}
            className="flex w-full items-center justify-center rounded-lg border border-dashed border-primary bg-primary-soft text-sm font-semibold text-primary"
          >
            <bdi dir="ltr">
              {format === "native" && box.size === "native" ? "native" : sizeLabel(box.size)}
            </bdi>
          </div>
        </figure>
      ))}
    </div>
  );
}

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function PlacementForm({
  placement,
  onSaved,
  onClose,
}: {
  placement: AdminPlacement;
  onSaved: () => void;
  onClose: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const banner = placement.key === BOTTOM_BANNER_KEY;
  const [enabled, setEnabled] = useState(placement.enabled);
  const [pageClasses, setPageClasses] = useState<PageClass[]>(placement.pageClasses);
  const [devices, setDevices] = useState<AdDevice[]>(placement.devices);
  const [maxPerPage, setMaxPerPage] = useState(String(placement.maxPerPage));
  const [sizeDesktop, setSizeDesktop] = useState(placement.sizeDesktop);
  const [sizeMobile, setSizeMobile] = useState(placement.sizeMobile);
  const [closable, setClosable] = useState(placement.closable);
  const [dismissDays, setDismissDays] = useState(String(placement.dismissDays));
  const [allowPaid, setAllowPaid] = useState(placement.allowPaid);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const body = {
      enabled,
      pageClasses,
      devices,
      maxPerPage: Number(maxPerPage),
      sizeDesktop: sizeDesktop.trim(),
      sizeMobile: sizeMobile.trim(),
      closable: banner ? true : closable,
      dismissDays: Number(dismissDays),
      allowPaid,
    };
    const parsed = updatePlacementSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] = tOr(`admin.ads.invalid.${field}`, t("admin.ads.invalid.generic"));
      }
      setErrors(next);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api(`/admin/ads/placements/${encodeURIComponent(placement.key)}`, {
          method: "PATCH",
          body: parsed.data,
          schema: adminPlacementSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.ads.placement.saved") });
          onSaved();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          setFormError(toApiError(error));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Code>{placement.key}</Code>
      <PlacementPreview
        sizeDesktop={sizeDesktop}
        sizeMobile={sizeMobile}
        format={placement.format}
      />
      <Checkbox
        name="enabled"
        label={t("admin.ads.placement.enabled")}
        checked={enabled}
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("admin.ads.placement.classes")}
        </legend>
        <p className="text-sm text-text-muted">
          {banner
            ? t("admin.ads.placement.classesBannerHint")
            : t("admin.ads.placement.classesHint")}
        </p>
        {SERVABLE_PAGE_CLASSES.map((pageClass) => (
          <Checkbox
            key={pageClass}
            name={`class-${pageClass}`}
            label={t(`admin.ads.class.${pageClass}`)}
            checked={pageClasses.includes(pageClass)}
            onChange={() => {
              setPageClasses((current) => toggled(current, pageClass));
            }}
          />
        ))}
        {errors["pageClasses"] ? (
          <p className="text-sm text-danger">{errors["pageClasses"]}</p>
        ) : null}
        <Notice tone="warning" className="mt-1">
          {t("admin.ads.placement.floor", {
            classes: NEVER_SERVE_CLASSES.map((pageClass) => t(`admin.ads.class.${pageClass}`)).join(
              "، ",
            ),
          })}
        </Notice>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("admin.ads.placement.devices")}
        </legend>
        {AD_DEVICES.map((device) => (
          <Checkbox
            key={device}
            name={`device-${device}`}
            label={t(`admin.ads.device.${device}`)}
            checked={devices.includes(device)}
            onChange={() => {
              setDevices((current) => toggled(current, device));
            }}
          />
        ))}
        {errors["devices"] ? <p className="text-sm text-danger">{errors["devices"]}</p> : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.ads.placement.maxPerPage")} error={errors["maxPerPage"]}>
          {(control) => (
            <Input
              {...control}
              name="maxPerPage"
              type="number"
              inputMode="numeric"
              ltr
              min={0}
              max={10}
              value={maxPerPage}
              onChange={(event) => {
                setMaxPerPage(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.ads.placement.dismissDays")}
          hint={t("admin.ads.placement.dismissDaysHint")}
          error={errors["dismissDays"]}
        >
          {(control) => (
            <Input
              {...control}
              name="dismissDays"
              type="number"
              inputMode="numeric"
              ltr
              min={1}
              max={365}
              value={dismissDays}
              onChange={(event) => {
                setDismissDays(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.ads.placement.sizeDesktop")}
          hint={t("admin.ads.placement.sizeHint")}
          error={errors["sizeDesktop"]}
        >
          {(control) => (
            <Input
              {...control}
              name="sizeDesktop"
              ltr
              autoComplete="off"
              value={sizeDesktop}
              onChange={(event) => {
                setSizeDesktop(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.ads.placement.sizeMobile")} error={errors["sizeMobile"]}>
          {(control) => (
            <Input
              {...control}
              name="sizeMobile"
              ltr
              autoComplete="off"
              value={sizeMobile}
              onChange={(event) => {
                setSizeMobile(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {banner ? null : (
        <Checkbox
          name="closable"
          label={t("admin.ads.placement.closable")}
          checked={closable}
          onChange={(event) => {
            setClosable(event.target.checked);
          }}
        />
      )}
      <Checkbox
        name="allowPaid"
        label={t("admin.ads.placement.allowPaid")}
        checked={allowPaid}
        onChange={(event) => {
          setAllowPaid(event.target.checked);
        }}
      />
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** Placements (docs/ADS.md §3): the catalog table and an edit drawer with a live preview of the box. */
export function AdsPlacementsView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/ads/placements", adminPlacementListSchema);
  const record = useOpenRecord();
  const rows = resource.status === "ready" ? resource.data.items : [];
  const open = rows.find((row) => row.key === record.id) ?? null;

  const columns: DataTableColumn<AdminPlacement>[] = [
    {
      id: "key",
      header: t("admin.ads.col.placement"),
      primary: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{tOr(`admin.ads.placement.${row.key}`, row.key)}</span>
          <Code>{row.key}</Code>
        </span>
      ),
    },
    {
      id: "enabled",
      header: t("admin.ads.col.status"),
      cell: (row) => (
        <Badge tone={row.enabled ? "success" : "neutral"}>
          {t(row.enabled ? "admin.ads.on" : "admin.ads.off")}
        </Badge>
      ),
    },
    {
      id: "classes",
      header: t("admin.ads.col.classes"),
      cell: (row) =>
        row.pageClasses.map((pageClass) => t(`admin.ads.class.${pageClass}`)).join("، "),
    },
    {
      id: "devices",
      header: t("admin.ads.col.devices"),
      cell: (row) => row.devices.map((device) => t(`admin.ads.device.${device}`)).join("، "),
    },
    {
      id: "max",
      header: t("admin.ads.col.maxPerPage"),
      cell: (row) => formatNumber(row.maxPerPage),
    },
    {
      id: "size",
      header: t("admin.ads.col.size"),
      cell: (row) => (
        <bdi dir="ltr">{`${sizeLabel(row.sizeDesktop)} / ${sizeLabel(row.sizeMobile)}`}</bdi>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <DataTable
        caption={t("admin.nav.adsPlacements")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={(row) => {
          record.open(row.key);
        }}
        openLabel={(row) => t("admin.ads.placement.open", { name: row.key })}
        emptyTitle={t("admin.ads.placement.empty")}
      />
      <RecordDrawer
        title={
          open ? tOr(`admin.ads.placement.${open.key}`, open.key) : t("admin.ads.placement.drawer")
        }
      >
        {(_id, close) =>
          open ? (
            canWrite ? (
              <PlacementForm
                key={open.key}
                placement={open}
                onSaved={resource.reload}
                onClose={close}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <Notice>{t("admin.ads.readOnly")}</Notice>
                <PlacementPreview
                  sizeDesktop={open.sizeDesktop}
                  sizeMobile={open.sizeMobile}
                  format={open.format}
                />
              </div>
            )
          ) : (
            <Notice>{t("admin.ads.placement.missing")}</Notice>
          )
        }
      </RecordDrawer>
    </div>
  );
}

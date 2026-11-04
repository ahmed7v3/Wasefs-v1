"use client";

import {
  EARLY_SIGNUP_STATUSES,
  adminEarlySignupsResponseSchema,
  type AdminEarlySignup,
  type EarlySortField,
} from "@wasfa/shared/schemas/early-access";
import { Badge, Button, Field, Select, Skeleton, Textarea, useToast } from "@wasfa/ui";
import { ArrowDownUp, Eye, EyeOff, MapPin } from "lucide-react";
import { useState } from "react";

import { formatDateTime, formatNumber } from "../../../lib/admin-format";
import { api } from "../../../lib/api-client";
import { buildQuery, useResource } from "../../../lib/use-admin-data";
import { useUrlParams } from "../../../lib/use-url-params";
import { ErrorNotice } from "../../error-notice";
import { DetailList, DetailSection } from "../detail-list";
import { DetailDrawer } from "../drawer";
import { FilterBar, type FilterField } from "../filter-bar";

import {
  ANSWER_LABEL,
  FEATURE_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  T,
  VARIANT_LABEL,
  countryName,
  formatPrice,
  labelOf,
  DEVICE_LABEL,
} from "./labels";

import type { EarlyFilters } from "./filters";

const PAGE_SIZE = 50;

const LIST_FIELDS: readonly FilterField[] = [
  { kind: "search", name: "q", label: T.signups.search },
  {
    kind: "select",
    name: "status",
    label: T.signups.statusFilter,
    allLabel: T.signups.allStatuses,
    options: EARLY_SIGNUP_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
  },
  {
    kind: "select",
    name: "completed",
    label: T.signups.completedFilter,
    allLabel: T.signups.completedAll,
    options: [
      { value: "yes", label: T.signups.completedYes },
      { value: "no", label: T.signups.completedNo },
    ],
  },
];

/** `+201234567890` -> `+20••••••7890`: the dial code and the last four digits stay. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 3)}${"•".repeat(phone.length - 7)}${phone.slice(-4)}`;
}

function mapUrl(row: AdminEarlySignup): string | null {
  if (row.latApprox === null || row.lonApprox === null) return null;
  // City-level zoom: the coordinates are approximate by design.
  return `https://www.openstreetmap.org/?mlat=${row.latApprox}&mlon=${row.lonApprox}#map=10/${row.latApprox}/${row.lonApprox}`;
}

function SignupDrawerBody({
  row,
  onSaved,
}: {
  row: AdminEarlySignup;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState(row.status);
  const [note, setNote] = useState(row.adminNote ?? "");
  const [busy, setBusy] = useState(false);
  const map = mapUrl(row);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/admin/early-access/signups/${row.id}`, {
        method: "PATCH",
        body: { status, adminNote: note.trim() === "" ? null : note.trim() },
      });
      toast({ tone: "success", title: T.signups.saved });
      onSaved();
    } catch {
      toast({ tone: "error", title: T.campaigns.failed });
    } finally {
      setBusy(false);
    }
  };

  const f = T.fields;
  const ltr = (value: string | null) => (value ? <bdi dir="ltr">{value}</bdi> : null);
  return (
    <>
      <DetailSection title={T.signups.drawerTitle}>
        <DetailList
          items={[
            { label: f.name, value: row.name },
            { label: f.phone, value: ltr(row.phoneE164) },
            { label: f.phoneCountry, value: countryName(row.phoneCountry) },
            { label: f.role, value: row.role ? labelOf(ROLE_LABEL, row.role) : null },
            { label: f.probe, value: formatPrice(row.probePriceMinor, row.probeCurrency) },
            {
              label: f.probeAnswer,
              value: row.probeAnswer ? labelOf(ANSWER_LABEL, row.probeAnswer) : null,
            },
            {
              label: f.fair,
              value:
                row.fairPriceMinor === null
                  ? row.stepsCompleted >= 2
                    ? T.signups.free
                    : null
                  : formatPrice(row.fairPriceMinor, row.probeCurrency),
            },
            {
              label: f.features,
              value: row.features.length
                ? row.features.map((x) => labelOf(FEATURE_LABEL, x)).join("، ")
                : null,
            },
            { label: f.refCode, value: ltr(row.refCode) },
            { label: f.invited, value: formatNumber(row.invited) },
            { label: f.referredBy, value: ltr(row.referredById) },
            { label: f.steps, value: formatNumber(row.stepsCompleted) },
            {
              label: f.timeToSubmit,
              value:
                row.timeToSubmitMs === null
                  ? null
                  : `${formatNumber(Math.round(row.timeToSubmitMs / 1000))} ${f.seconds}`,
            },
          ]}
        />
      </DetailSection>
      <DetailSection title={T.filters.country}>
        <DetailList
          items={[
            { label: f.country, value: row.country ? countryName(row.country) : null },
            { label: f.region, value: row.region },
            { label: f.city, value: row.city },
            { label: f.timezone, value: ltr(row.timezone) },
            {
              label: f.coords,
              value:
                row.latApprox === null || row.lonApprox === null ? null : (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <bdi dir="ltr">{`${row.latApprox}, ${row.lonApprox}`}</bdi>
                    {map ? (
                      <a
                        href={map}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                      >
                        <MapPin aria-hidden className="size-4" />
                        {T.signups.map}
                      </a>
                    ) : null}
                  </span>
                ),
            },
          ]}
        />
      </DetailSection>
      <DetailSection title={T.signups.source}>
        <DetailList
          items={[
            { label: f.campaign, value: row.campaignName },
            { label: f.variant, value: row.variant ? labelOf(VARIANT_LABEL, row.variant) : null },
            { label: f.referrer, value: ltr(row.referrerHost) },
            {
              label: f.utm,
              value: Object.keys(row.utm).length ? (
                <bdi dir="ltr" className="break-all">
                  {Object.entries(row.utm)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ")}
                </bdi>
              ) : null,
            },
            { label: f.device, value: row.device ? labelOf(DEVICE_LABEL, row.device) : null },
            { label: f.browser, value: row.browser },
            { label: f.os, value: row.os },
            { label: f.lang, value: ltr(row.lang) },
            { label: f.createdAt, value: formatDateTime(row.createdAt) },
            { label: f.updatedAt, value: formatDateTime(row.updatedAt) },
          ]}
        />
      </DetailSection>
      <DetailSection title={T.signups.status}>
        <Field label={T.signups.status}>
          {(control) => (
            <Select
              {...control}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
              }}
            >
              {EARLY_SIGNUP_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={T.signups.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
        <div>
          <Button disabled={busy} onClick={() => void save()}>
            {T.signups.save}
          </Button>
        </div>
      </DetailSection>
    </>
  );
}

export function SignupsPanel({ filters }: { filters: EarlyFilters }) {
  const url = useUrlParams();
  const q = url.get("q");
  const status = url.get("status");
  const completed = url.get("completed");
  const sortParam = url.get("sort") as EarlySortField | "";
  const sort: EarlySortField = sortParam === "" ? "createdAt" : sortParam;
  const dir = url.get("dir") === "asc" ? "asc" : "desc";
  const openId = url.get("signup");
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const baseQuery = buildQuery({ ...filters.params, q, status, completed, sort, dir });
  // Any filter or sort change goes back to page 1.
  const [pageState, setPageState] = useState({ key: baseQuery, page: 1 });
  const page = pageState.key === baseQuery ? pageState.page : 1;

  const resource = useResource(
    `/admin/early-access/signups?${baseQuery}&page=${page}&pageSize=${PAGE_SIZE}`,
    adminEarlySignupsResponseSchema,
  );

  const toggleSort = (field: EarlySortField) => {
    url.update({
      sort: field,
      dir: sort === field && dir === "desc" ? "asc" : "desc",
    });
  };

  const header = (field: EarlySortField | null, label: string) => (
    <th
      scope="col"
      aria-sort={field && sort === field ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className="px-3 py-2 text-start font-semibold whitespace-nowrap"
    >
      {field ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:shadow-focus"
          onClick={() => {
            toggleSort(field);
          }}
        >
          {label}
          <ArrowDownUp aria-hidden className="size-3.5" />
        </button>
      ) : (
        label
      )}
    </th>
  );

  const toggleReveal = (id: string) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const body = () => {
    if (resource.status === "loading") {
      return (
        <div className="flex flex-col gap-2" aria-busy="true">
          <p className="sr-only" role="status">
            {T.loading}
          </p>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }
    if (resource.status === "error") {
      return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
    }
    const { items, total, pageSize } = resource.data;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const open = items.find((item) => item.id === openId);
    return (
      <>
        {items.length === 0 ? (
          <p className="py-8 text-center text-text-muted">{T.signups.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[64rem] text-sm tabular-nums">
              <caption className="sr-only">{T.tabs.signups}</caption>
              <thead className="text-text-muted">
                <tr>
                  {header("createdAt", T.signups.date)}
                  {header("name", T.signups.name)}
                  {header(null, T.signups.phone)}
                  {header("country", T.signups.place)}
                  {header("role", T.signups.role)}
                  {header("probePriceMinor", T.signups.probe)}
                  {header("fairPriceMinor", T.signups.fair)}
                  {header(null, T.signups.features)}
                  {header(null, T.signups.source)}
                  {header("invited", T.signups.invited)}
                  {header("status", T.signups.status)}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const shown = revealed.has(row.id);
                  return (
                    <tr key={row.id} className="border-t border-border hover:bg-primary-soft/40">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-label={`${T.signups.open}: ${row.name ?? row.phoneE164}`}
                          className="text-start font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                          onClick={() => {
                            url.update({ signup: row.id });
                          }}
                        >
                          {row.name ?? "—"}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <bdi dir="ltr">{shown ? row.phoneE164 : maskPhone(row.phoneE164)}</bdi>
                          <button
                            type="button"
                            aria-label={shown ? T.signups.hide : T.signups.reveal}
                            aria-pressed={shown}
                            className="inline-flex size-8 items-center justify-center rounded text-neutral-600 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                            onClick={() => {
                              toggleReveal(row.id);
                            }}
                          >
                            {shown ? (
                              <EyeOff aria-hidden className="size-4" />
                            ) : (
                              <Eye aria-hidden className="size-4" />
                            )}
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {countryName(row.country ?? row.phoneCountry)}
                        {row.city ? ` · ${row.city}` : ""}
                      </td>
                      <td className="px-3 py-2">{row.role ? labelOf(ROLE_LABEL, row.role) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatPrice(row.probePriceMinor, row.probeCurrency)}
                        {row.probeAnswer ? ` · ${labelOf(ANSWER_LABEL, row.probeAnswer)}` : ""}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.fairPriceMinor !== null
                          ? formatPrice(row.fairPriceMinor, row.probeCurrency)
                          : row.stepsCompleted >= 2
                            ? T.signups.free
                            : "—"}
                      </td>
                      <td className="px-3 py-2">{formatNumber(row.features.length)}</td>
                      <td className="px-3 py-2">
                        {row.campaignName ?? row.utm["source"] ?? row.referrerHost ?? "—"}
                      </td>
                      <td className="px-3 py-2">{formatNumber(row.invited)}</td>
                      <td className="px-3 py-2">
                        <Badge>{STATUS_LABEL[row.status]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm tabular-nums text-text-muted">
          <span>
            {T.signups.total}: {formatNumber(total)}
          </span>
          <span className="inline-flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => {
                setPageState({ key: baseQuery, page: page - 1 });
              }}
            >
              {T.signups.prev}
            </Button>
            <span>
              {T.signups.page} {formatNumber(page)} {T.signups.of} {formatNumber(pages)}
            </span>
            <Button
              variant="secondary"
              disabled={page >= pages}
              onClick={() => {
                setPageState({ key: baseQuery, page: page + 1 });
              }}
            >
              {T.signups.next}
            </Button>
          </span>
        </div>
        <DetailDrawer
          open={open !== undefined}
          onClose={() => {
            url.update({ signup: null });
          }}
          title={open?.name ?? open?.phoneE164 ?? T.signups.drawerTitle}
        >
          {open ? <SignupDrawerBody key={open.id} row={open} onSaved={resource.reload} /> : null}
        </DetailDrawer>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBar fields={LIST_FIELDS} />
      {body()}
    </div>
  );
}

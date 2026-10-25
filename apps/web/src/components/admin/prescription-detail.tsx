"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Badge, Button, Card, type BadgeTone } from "@wasfa/ui";
import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";

import type { AdminPrescriptionDetail } from "@wasfa/shared/schemas/admin-user-360";
import type { RxResultItem } from "@wasfa/shared/schemas/rx";

const STATUS_TONE: Record<string, BadgeTone> = {
  done: "success",
  failed: "danger",
  refunded: "warning",
};
const BADGE_TONE: Record<RxResultItem["badge"], BadgeTone> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

/** `$0.0123`: one analysis costs fractions of a cent, so four decimals. */
export const usdFromMicros = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

export function RxStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "info"}>{tOr(`rx.status.${status}`, status)}</Badge>;
}

const dash = "—";

function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-base text-text [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function PageImage({
  image,
  refreshed,
  onExpired,
}: {
  image: AdminPrescriptionDetail["images"][number];
  refreshed: boolean;
  onExpired: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = t("admin.user360.rx.page", { page: String(image.pageNo) });
  let body: ReactNode;
  if (image.url === null) {
    body = <p className="p-4 text-sm text-text-muted">{t("admin.user360.rx.imageGone")}</p>;
  } else if (failedUrl === image.url) {
    // A presigned link lives 60 s: the parent re-fetches once; a second failure is shown as is.
    body = (
      <p className="p-4 text-sm text-text-muted">
        {refreshed ? t("admin.user360.rx.imageFailed") : t("admin.user360.rx.imageRefreshing")}
      </p>
    );
  } else {
    const url = image.url;
    body = (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${t("admin.user360.rx.openImage")} · ${label}`}
        className="block"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL of a private file, not an optimisable asset */}
        <img
          src={url}
          alt={label}
          className="block h-auto w-full max-w-full"
          onError={() => {
            setFailedUrl(url);
            onExpired();
          }}
        />
      </a>
    );
  }
  return (
    <figure className="m-0 flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-neutral-100">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-sm font-semibold text-text">
        {label}
        {image.url ? <ExternalLink aria-hidden className="size-4 text-text-muted" /> : null}
      </figcaption>
      {body}
    </figure>
  );
}

function ItemCard({
  item,
  index,
  matching,
}: {
  item: RxResultItem;
  index: number;
  matching: string | undefined;
}) {
  const rows: [MessageKey, string | null][] = [
    ["admin.user360.rx.f.name", item.name],
    [
      "admin.user360.rx.f.activeIngredients",
      item.activeIngredients.length > 0 ? item.activeIngredients.join(", ") : null,
    ],
    ["admin.user360.rx.f.strength", item.strength],
    ["admin.user360.rx.f.form", item.form],
    ["admin.user360.rx.f.dose", item.dose],
    ["admin.user360.rx.f.frequency", item.frequency],
    ["admin.user360.rx.f.duration", item.duration],
    ["admin.user360.rx.f.route", item.route],
    ["admin.user360.rx.f.notes", item.notes],
  ];
  const match =
    matching === "model"
      ? t("admin.user360.rx.matchingModel")
      : item.matchedDrugId
        ? t("admin.user360.rx.matched", {
            score:
              item.matchScore === null ? dash : `${String(Math.round(item.matchScore * 100))}%`,
          })
        : t("admin.user360.rx.unmatched");
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading text-base font-semibold text-text">
          {t("admin.user360.rx.item", { n: String(index + 1) })}
          <span className="ms-2 text-sm font-normal text-text-muted">
            {t("admin.user360.rx.onPage", { page: String(item.page + 1) })}
          </span>
        </span>
        <Badge tone={BADGE_TONE[item.badge]}>{t(`rx.badge.${item.badge}` as MessageKey)}</Badge>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Pair label={t("admin.user360.rx.f.rawText")}>
            <bdi className="whitespace-pre-wrap">{item.rawText}</bdi>
          </Pair>
        </div>
        {rows.map(([key, value]) => (
          <Pair key={key} label={t(key)}>
            {value ?? dash}
          </Pair>
        ))}
        <Pair
          label={t("admin.user360.rx.f.confidence")}
        >{`${String(Math.round(item.confidence * 100))}%`}</Pair>
        <Pair label={t("admin.user360.rx.f.matching")}>{match}</Pair>
        <Pair label={t("admin.user360.rx.f.verified")}>
          {t(`admin.user360.rx.verified.${item.verified}` as MessageKey)}
        </Pair>
      </dl>
    </li>
  );
}

function RawJson({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-base font-semibold text-text">
        {t("admin.user360.rx.raw")}
      </summary>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <div>
          <Button
            variant="secondary"
            name="copy-rx-json"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
        </div>
        <pre
          dir="ltr"
          className="max-h-[32rem] max-w-full overflow-auto rounded-md bg-neutral-100 p-3 text-start text-xs text-text"
        >
          {text}
        </pre>
      </div>
    </details>
  );
}

const yesNo = (value: boolean) => t(value ? "admin.user360.rx.yes" : "admin.user360.rx.no");
const when = (value: string | null) => (value ? formatDateTime(value) : dash);

function DetailsSection({ data }: { data: AdminPrescriptionDetail }) {
  const { view, details } = data;
  return (
    <section aria-labelledby="rx-details-title" className="flex flex-col gap-3">
      <h3 id="rx-details-title" className="font-heading text-lg font-semibold text-text">
        {t("admin.user360.rx.detailsTitle")}
      </h3>
      <Card elevation="flat">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Pair label={t("admin.user360.rx.d.status")}>
            <RxStatusBadge status={view.status} />
          </Pair>
          <Pair label={t("admin.user360.rx.d.mode")}>{view.mode}</Pair>
          <Pair label={t("admin.user360.rx.d.credits")}>{formatNumber(view.creditsCharged)}</Pair>
          <Pair label={t("admin.user360.rx.d.cost")}>
            <bdi dir="ltr">{usdFromMicros(details.costUsdMicros)}</bdi>
          </Pair>
          <Pair label={t("admin.user360.rx.d.skillVersion")}>
            <bdi dir="ltr">{details.skillVersion}</bdi>
          </Pair>
          <Pair label={t("admin.user360.rx.d.routeVersion")}>{details.routeVersion ?? dash}</Pair>
          <Pair label={t("admin.user360.rx.d.created")}>{when(view.createdAt)}</Pair>
          <Pair label={t("admin.user360.rx.d.queued")}>{when(details.queuedAt)}</Pair>
          <Pair label={t("admin.user360.rx.d.started")}>{when(details.startedAt)}</Pair>
          <Pair label={t("admin.user360.rx.d.finished")}>{when(details.finishedAt)}</Pair>
          <Pair label={t("admin.user360.rx.d.duration")}>
            {details.durationMs === null
              ? dash
              : t("admin.user360.rx.seconds", { seconds: (details.durationMs / 1_000).toFixed(1) })}
          </Pair>
          <Pair label={t("admin.user360.rx.d.cached")}>{yesNo(details.cached)}</Pair>
          {details.cacheOf ? (
            <Pair label={t("admin.user360.rx.d.cacheOf")}>
              <bdi dir="ltr" className="text-xs">
                {details.cacheOf}
              </bdi>
            </Pair>
          ) : null}
          <Pair label={t("admin.user360.rx.d.patient")}>{details.patientInitials ?? dash}</Pair>
          <Pair label={t("admin.user360.rx.d.prescriber")}>
            {details.prescriberInitials ?? dash}
          </Pair>
          <Pair label={t("admin.user360.rx.d.createdBy")}>{details.createdBy?.name ?? dash}</Pair>
          <Pair label={t("admin.user360.rx.d.rating")}>
            {details.rating ? t(`admin.user360.rx.rating.${details.rating}` as MessageKey) : dash}
          </Pair>
          <Pair label={t("admin.user360.rx.d.ratedAt")}>{when(details.ratedAt)}</Pair>
          <Pair label={t("admin.user360.rx.d.share")}>{yesNo(details.shareForReview)}</Pair>
          <div className="sm:col-span-2 xl:col-span-3">
            <Pair label={t("admin.user360.rx.d.ratingNote")}>{details.ratingNote ?? dash}</Pair>
          </div>
          {view.errorRef ? (
            <Pair label={t("admin.user360.rx.d.errorRef")}>
              <bdi dir="ltr">{view.errorRef}</bdi>
            </Pair>
          ) : null}
        </dl>
      </Card>
    </section>
  );
}

function CorrectionsSection({
  corrections,
}: {
  corrections: AdminPrescriptionDetail["details"]["corrections"];
}) {
  return (
    <section aria-labelledby="rx-corrections-title" className="flex flex-col gap-3">
      <h3 id="rx-corrections-title" className="font-heading text-lg font-semibold text-text">
        {t("admin.user360.rx.corrections")}
      </h3>
      {corrections.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.user360.rx.noCorrections")}</p>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <thead className="bg-neutral-100 text-text-muted">
              <tr>
                {(["item", "field", "before", "after", "date", "consent"] as const).map(
                  (column) => (
                    <th key={column} scope="col" className="px-3 py-2 text-start font-semibold">
                      {t(`admin.user360.rx.c.${column}` as MessageKey)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {corrections.map((row, index) => (
                <tr
                  key={`${String(row.itemIndex)}-${row.field}-${String(index)}`}
                  className="border-t border-border/60 align-top"
                >
                  <td className="px-3 py-2 tabular-nums">{row.itemIndex + 1}</td>
                  <td className="px-3 py-2">
                    <bdi dir="ltr">{row.field}</bdi>
                  </td>
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.before ?? dash}</td>
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.after ?? dash}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-3 py-2">{yesNo(row.consentForEval)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * One analysis in full (images, every reading, details, corrections, raw JSON). A wide screen puts
 * the pictures beside the reading; a narrow one stacks them. Nothing here is wider than its box.
 */
export function PrescriptionDetail({
  data,
  refreshed,
  onExpired,
  onBack,
}: {
  data: AdminPrescriptionDetail;
  /** True once the pictures' links were re-fetched after one failed to load. */
  refreshed: boolean;
  onExpired: () => void;
  onBack: () => void;
}) {
  const { view } = data;
  const result = view.result;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="admin-rx-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" name="close-rx" onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          {t("admin.user360.rx.back")}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <RxStatusBadge status={view.status} />
          <span className="text-sm text-text-muted tabular-nums">
            {formatDateTime(view.createdAt)}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="rx-pages-title" className="flex min-w-0 flex-col gap-3">
          <h3 id="rx-pages-title" className="font-heading text-lg font-semibold text-text">
            {t("admin.user360.rx.pagesTitle")}
          </h3>
          {data.images.length === 0 ? (
            <p className="text-base text-text-muted">{t("admin.user360.rx.imageGone")}</p>
          ) : (
            data.images.map((image) => (
              <PageImage
                key={image.fileId}
                image={image}
                refreshed={refreshed}
                onExpired={onExpired}
              />
            ))
          )}
        </section>

        <section aria-labelledby="rx-analysis-title" className="flex min-w-0 flex-col gap-3">
          <h3 id="rx-analysis-title" className="font-heading text-lg font-semibold text-text">
            {t("admin.user360.rx.analysis")}
          </h3>
          {result === null ? (
            <p className="text-base text-text-muted">{t("admin.user360.rx.noResult")}</p>
          ) : (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Pair label={t("admin.user360.rx.prescriptionDate")}>{result.date ?? dash}</Pair>
                <Pair label={t("admin.user360.rx.legible")}>{yesNo(result.prescriberLegible)}</Pair>
                <Pair label={t("admin.user360.rx.unreadableRegions")}>
                  {formatNumber(result.unreadableRegions.length)}
                </Pair>
              </dl>
              <ol className="flex flex-col gap-3">
                {result.items.map((item, index) => (
                  <ItemCard
                    key={`${String(index)}-${item.rawText}`}
                    item={item}
                    index={index}
                    matching={result.matching}
                  />
                ))}
              </ol>
              <div className="flex flex-col gap-2">
                <h4 className="text-base font-semibold text-text">
                  {t("admin.user360.rx.findings")}
                </h4>
                {result.findings.length === 0 ? (
                  <p className="text-sm text-text-muted">{t("admin.user360.rx.noFindings")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {result.findings.map((finding, index) => (
                      <li
                        key={`${finding.kind}-${String(index)}`}
                        className="rounded-md border border-border bg-warning-soft p-3 text-sm text-text"
                      >
                        <p>{t(`rx.finding.${finding.kind}` as MessageKey)}</p>
                        <p className="text-text-muted">
                          {[
                            finding.ingredient,
                            t("rx.finding.lines", {
                              items: finding.itemIndexes.map((i) => String(i + 1)).join(", "),
                            }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <DetailsSection data={data} />
      <CorrectionsSection corrections={data.details.corrections} />
      {result === null ? null : <RawJson value={result} />}
      <p className="text-xs text-text-muted">{t("admin.user360.phi.audited")}</p>
    </div>
  );
}

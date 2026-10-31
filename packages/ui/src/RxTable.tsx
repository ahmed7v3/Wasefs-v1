"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "./cn";
import { ConfidenceBadge, shownConfidence } from "./ConfidenceBadge";
import { RxItemDetails } from "./RxItemDetails";

import type { RxResultItem } from "@wasfa/shared/schemas/rx";
import type { FocusEvent } from "react";

export type RxTableItem = Pick<
  RxResultItem,
  | "rawText"
  | "name"
  | "matchedDrugId"
  | "activeIngredients"
  | "strength"
  | "form"
  | "dose"
  | "frequency"
  | "duration"
  | "route"
  | "badge"
  | "verified"
  | "details"
  | "source"
  | "match"
  | "suggestion"
>;

export interface RxTableProps {
  items: readonly RxTableItem[];
  /** The row to highlight (hovered or focused, else the selected one). */
  activeIndex: number | null;
  /** The row chosen by a click, a tap or a region on the image. */
  selectedIndex: number | null;
  /** Pointer or focus entered (`index`) or left (`null`) a row. */
  onActivate: (index: number | null) => void;
  onSelect: (index: number) => void;
  /** "راجع": open the candidate picker for this row. */
  onReview: (index: number) => void;
  /** Rows whose correction is being saved. */
  pending?: ReadonlySet<number> | undefined;
  /**
   * The model read the lines on its own (no drug database): no line is "unmatched", the name the
   * model gave is shown, and only the confidence decides what needs a second look.
   */
  modelOnly?: boolean | undefined;
  className?: string | undefined;
}

/** Strength and form sit beside the name; the columns left are the directions. A column empty on every row is not drawn. */
const TEXT_COLUMNS = [
  ["dose", "rx.col.dose"],
  ["frequency", "rx.col.frequency"],
  ["duration", "rx.col.duration"],
  ["route", "rx.col.route"],
] as const satisfies readonly (readonly [keyof RxTableItem, MessageKey])[];

/**
 * What to call the line: the matched brand; for an unmatched line the raw text read (never a name
 * the model guessed) unless the person typed their own correction.
 */
export function drugTitle(
  item: Pick<RxTableItem, "rawText" | "name" | "matchedDrugId" | "verified">,
  modelOnly = false,
): string {
  const useName = modelOnly || item.matchedDrugId !== null || item.verified === "corrected";
  // Never directions as a name: Arabic words mixed into a Latin line are cut off (see rx-sanitize).
  return displayName((useName ? item.name : null) ?? item.rawText).trim();
}

/** Where a row needs a person's eye: an unmatched name, or anything that is not high confidence. */
export function needsReview(
  item: Pick<RxTableItem, "badge" | "matchedDrugId">,
  modelOnly = false,
): boolean {
  return (!modelOnly && item.matchedDrugId === null) || item.badge !== "high";
}

/**
 * The prescription lines as a real table with header cells and `scope`. Below `xl` the same markup
 * is laid out as stacked cards; explicit ARIA roles keep it announced as a table, rows and cells
 * when CSS changes the display of the table elements. Numbers use `tabular-nums`.
 *
 * Medium and low rows get an amber edge on the inline-start side and a "راجع" button. The drug
 * name is a button that selects the row (and so its box on the image); hovering or focusing a row
 * reports it through `onActivate`.
 */
export function RxTable({
  items,
  activeIndex,
  selectedIndex,
  onActivate,
  onSelect,
  onReview,
  pending,
  modelOnly = false,
  className,
}: RxTableProps) {
  const rows = useRef(new Map<number, HTMLTableRowElement>());
  const columns = TEXT_COLUMNS.filter(([key]) =>
    items.some((item) => (item[key] ?? "").trim() !== ""),
  );
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  // A region tapped on the image selected this row: bring it into view.
  useEffect(() => {
    if (selectedIndex === null) return;
    const row = rows.current.get(selectedIndex);
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    // The roles repeat the native semantics on purpose: `display` overrides below xl can drop them.
    <table
      role="table"
      className={cn("w-full border-collapse text-start tabular-nums max-xl:block", className)}
    >
      <caption className="sr-only">{t("rx.table.caption")}</caption>
      <thead className="max-xl:sr-only">
        <tr role="row" className="border-b border-border text-sm text-text-muted">
          <th role="columnheader" scope="col" className="px-3 py-2 text-start font-semibold">
            {t("rx.col.drug")}
          </th>
          {columns.map(([key, label]) => (
            <th
              key={key}
              role="columnheader"
              scope="col"
              className="px-3 py-2 text-start font-semibold"
            >
              {t(label)}
            </th>
          ))}
          <th role="columnheader" scope="col" className="px-3 py-2 text-start font-semibold">
            {t("rx.col.status")}
          </th>
        </tr>
      </thead>
      <tbody className="max-xl:flex max-xl:flex-col max-xl:gap-3">
        {items.map((item, index) => {
          const unmatched = !modelOnly && item.matchedDrugId === null;
          const flagged = needsReview(item, modelOnly);
          const level = shownConfidence(item.badge, unmatched);
          const title = drugTitle(item, modelOnly);
          // "500 mg · أقراص": strength as written, the form in Arabic.
          const beside = [item.strength, formLabel(item.form, "ar")]
            .filter((part): part is string => part !== null && part.trim() !== "")
            .join(" · ");
          const hasDetails = item.details !== undefined && item.details !== null;
          const expanded = hasDetails && open.has(index);
          const detailsId = `rx-details-${String(index)}`;
          const isActive = activeIndex === index;
          const isSelected = selectedIndex === index;
          const saving = pending?.has(index) ?? false;
          return (
            <Fragment key={index}>
              <tr
                role="row"
                ref={(element) => {
                  if (element) rows.current.set(index, element);
                  else rows.current.delete(index);
                }}
                data-row-index={index}
                data-active={isActive ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                data-flagged={flagged ? "true" : undefined}
                data-confidence={level}
                aria-busy={saving || undefined}
                onMouseEnter={() => {
                  onActivate(index);
                }}
                onMouseLeave={() => {
                  onActivate(null);
                }}
                onFocus={() => {
                  onActivate(index);
                }}
                onBlur={(event: FocusEvent<HTMLTableRowElement>) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) onActivate(null);
                }}
                className={cn(
                  "border-b border-border align-top transition-colors duration-150",
                  // Amber edge on the inline-start side; unflagged rows keep the space so columns line up.
                  "max-xl:block max-xl:rounded-lg max-xl:border max-xl:border-s-4 max-xl:p-3",
                  flagged ? "max-xl:border-s-warning" : "max-xl:border-s-transparent",
                  isActive || isSelected ? "bg-primary-soft" : "hover:bg-neutral-100",
                  saving && "opacity-70",
                )}
              >
                <th
                  role="rowheader"
                  scope="row"
                  className={cn(
                    "px-3 py-2 text-start font-normal max-xl:block max-xl:p-0",
                    "xl:border-s-4",
                    flagged ? "xl:border-s-warning" : "xl:border-s-transparent",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={t("rx.item.show", { name: title })}
                    onClick={() => {
                      onSelect(index);
                    }}
                    className="min-h-11 w-full rounded-md text-start focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <span className="block text-base font-semibold text-text">
                      <bdi>{title}</bdi>
                      {beside === "" ? null : (
                        <span className="ms-2 text-sm font-normal text-text-muted">
                          <bdi>{beside}</bdi>
                        </span>
                      )}
                    </span>
                    {!unmatched && item.activeIngredients.length > 0 ? (
                      <span className="block text-sm font-normal text-text-muted">
                        <bdi>{item.activeIngredients.join(" + ")}</bdi>
                      </span>
                    ) : null}
                  </button>
                </th>
                {columns.map(([key, label]) => {
                  const value = item[key];
                  const has = value !== null && value.trim() !== "";
                  return (
                    <td
                      key={key}
                      role="cell"
                      className={cn(
                        "px-3 py-2 text-base text-text max-xl:flex max-xl:items-baseline max-xl:justify-between max-xl:gap-3 max-xl:px-0 max-xl:py-1",
                        !has && "max-xl:hidden",
                      )}
                    >
                      <span aria-hidden className="text-sm text-text-muted xl:hidden">
                        {t(label)}
                      </span>
                      {has ? (
                        <bdi>{value}</bdi>
                      ) : (
                        <>
                          <span aria-hidden className="text-text-muted">
                            —
                          </span>
                          <span className="sr-only">{t("rx.item.emptyValue")}</span>
                        </>
                      )}
                    </td>
                  );
                })}
                <td
                  role="cell"
                  className="px-3 py-2 max-xl:flex max-xl:flex-wrap max-xl:items-center max-xl:gap-2 max-xl:px-0 max-xl:pb-0 max-xl:pt-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {item.match === "likely" ? (
                      <span
                        title={t("rx.match.likelyHint")}
                        className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary"
                      >
                        {t("rx.match.likely")}
                      </span>
                    ) : null}
                    <ConfidenceBadge level={item.badge} unmatched={unmatched} />
                    {item.suggestion ? (
                      <span className="text-sm text-text-muted">
                        {t("rx.match.suggestion", { name: item.suggestion.name })}
                      </span>
                    ) : null}
                    {item.source === "ai" ? (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-text-muted">
                        {t("rx.source.ai")}
                      </span>
                    ) : null}
                    {item.verified === "corrected" ? (
                      <span className="text-sm text-text-muted">{t("rx.item.corrected")}</span>
                    ) : null}
                    {hasDetails ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? detailsId : undefined}
                        aria-label={t(
                          expanded ? "rx.item.hideDetailsLabel" : "rx.item.detailsLabel",
                          {
                            name: title,
                          },
                        )}
                        onClick={() => {
                          toggle(index);
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-neutral-400 bg-surface px-3 text-base font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {t("rx.item.details")}
                        {expanded ? (
                          <ChevronUp aria-hidden className="size-4" />
                        ) : (
                          <ChevronDown aria-hidden className="size-4" />
                        )}
                      </button>
                    ) : null}
                    {flagged ? (
                      <button
                        type="button"
                        aria-label={t("rx.item.reviewLabel", { name: title })}
                        onClick={() => {
                          onReview(index);
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-warning bg-warning-soft px-4 text-base font-semibold text-warning hover:bg-surface focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {t("rx.item.review")}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
              {expanded && item.details ? (
                <tr
                  role="row"
                  id={detailsId}
                  className="border-b border-border bg-neutral-100 max-xl:-mt-3 max-xl:block max-xl:rounded-b-lg"
                >
                  <td role="cell" colSpan={columns.length + 2} className="px-4 py-3 max-xl:block">
                    <RxItemDetails details={item.details} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

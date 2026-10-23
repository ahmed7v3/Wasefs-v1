import { t } from "@wasfa/shared/i18n/public";
import { Check, Minus } from "lucide-react";

import { cn } from "../cn";

import type { Locale } from "@wasfa/shared/i18n";

/** A cell: text, a plain yes/no, or nothing known (a dash). */
export type ComparisonCell = string | boolean | null;

export interface ComparisonColumn {
  key: string;
  name: string;
  /** The plan the person is on or the page recommends. */
  highlighted?: boolean | undefined;
}

export interface ComparisonRow {
  key: string;
  label: string;
  /** One value per column, in the order of `columns`. */
  cells: readonly ComparisonCell[];
}

export interface ComparisonTableProps {
  caption: string;
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  locale?: Locale | undefined;
  className?: string | undefined;
}

function Cell({ value, locale }: { value: ComparisonCell; locale: Locale }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden className="mx-auto size-5 text-success" />
        <span className="sr-only">{t("billing.compare.yes", undefined, locale)}</span>
      </>
    );
  }
  if (value === false || value === null) {
    return (
      <>
        <Minus aria-hidden className="mx-auto size-5 text-neutral-500" />
        <span className="sr-only">
          {value === false
            ? t("billing.compare.no", undefined, locale)
            : t("billing.compare.unknown", undefined, locale)}
        </span>
      </>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

/**
 * The plans side by side. The wide table scrolls inside its own box (focusable, so the keyboard can
 * scroll it) and never makes the page scroll sideways at 360 px.
 */
export function ComparisonTable({
  caption,
  columns,
  rows,
  locale = "ar",
  className,
}: ComparisonTableProps) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-xl border border-border/60 bg-surface focus-visible:outline-none focus-visible:shadow-focus",
        className,
      )}
    >
      <table className="w-full min-w-xl border-collapse text-start text-base">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border/60 bg-neutral-50">
            <th scope="col" className="p-3 text-start font-semibold text-text-muted">
              <span className="sr-only">{t("billing.compare.feature", undefined, locale)}</span>
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "p-3 text-center font-heading font-bold text-text",
                  column.highlighted && "bg-primary-soft text-primary",
                )}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/40 last:border-b-0">
              <th scope="row" className="p-3 text-start font-semibold text-text">
                {row.label}
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.key ?? index}
                  className={cn(
                    "p-3 text-center",
                    columns[index]?.highlighted && "bg-primary-soft/40",
                  )}
                >
                  <Cell value={cell} locale={locale} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

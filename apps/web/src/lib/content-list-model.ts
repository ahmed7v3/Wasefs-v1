import { t } from "@wasfa/shared/i18n";

import { tOr } from "./admin-format";
import { addDays } from "./content-time";

import type { MessageKey } from "@wasfa/shared/i18n";
import type { ContentItemSummary } from "@wasfa/shared/schemas/content";

/*
 * Pure model of the content list: which URL params are filters, the saved views (constants in code,
 * CONTENT-PLATFORM §8.4), the CSV of the loaded rows and the wording of a failed bulk item.
 */

/** Every URL param that narrows the list; `buildQuery` leaves the empty ones out. */
export const CONTENT_FILTER_PARAMS = [
  "type",
  "status",
  "locale",
  "categoryId",
  "authorId",
  "reviewerId",
  "source",
  "from",
  "to",
  "scheduledFrom",
  "scheduledTo",
  "live",
  "reviewOverdue",
  "hasIssues",
  "q",
] as const;
export type ContentFilterParam = (typeof CONTENT_FILTER_PARAMS)[number];

/** The toggles are sent as `true` only: the API coerces any non-empty string, "false" included, to true. */
export const CONTENT_TOGGLE_PARAMS = ["live", "reviewOverdue", "hasIssues"] as const;

/** Rows per request; the list is keyset-paged and the CSV covers what was loaded. */
export const CONTENT_LIST_LIMIT = 50;
/** The CSV export never writes more rows than this. */
export const CSV_EXPORT_CAP = 1000;

/** The filter params of the list as a name → value record (empty strings for unset ones). */
export function readContentFilters(get: (name: string) => string): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const name of CONTENT_FILTER_PARAMS) {
    const value = get(name);
    if ((CONTENT_TOGGLE_PARAMS as readonly string[]).includes(name)) {
      filters[name] = value === "true" ? "true" : "";
    } else {
      filters[name] = value;
    }
  }
  return filters;
}

/** True when anything other than the nav-link `type` narrows the list. */
export function hasExtraFilters(filters: Record<string, string>): boolean {
  return Object.entries(filters).some(([name, value]) => name !== "type" && value !== "");
}

export interface SavedView {
  id: "inReview" | "scheduledThisWeek" | "reviewOverdue" | "apiToday" | "mine";
  label: MessageKey;
  /** The filter params the chip sets; every other filter is cleared when it is chosen. */
  params: Record<string, string>;
}

export interface SavedViewContext {
  /** Today in the content time zone, `YYYY-MM-DD`. */
  today: string;
  /** The people profile linked to the signed-in account, when there is one. */
  myPersonId: string | null;
}

/** The saved views. «مسوّداتي» exists only when the account is linked to a person. */
export function savedViews({ today, myPersonId }: SavedViewContext): SavedView[] {
  const views: SavedView[] = [
    { id: "inReview", label: "admin.content.view.inReview", params: { status: "in_review" } },
    {
      id: "scheduledThisWeek",
      label: "admin.content.view.scheduledThisWeek",
      params: { status: "scheduled", scheduledFrom: today, scheduledTo: addDays(today, 6) },
    },
    {
      id: "reviewOverdue",
      label: "admin.content.view.reviewOverdue",
      params: { reviewOverdue: "true" },
    },
    {
      id: "apiToday",
      label: "admin.content.view.apiToday",
      params: { source: "api", from: today },
    },
  ];
  if (myPersonId) {
    views.push({
      id: "mine",
      label: "admin.content.view.mine",
      params: { status: "draft", authorId: myPersonId },
    });
  }
  return views;
}

/** The URL patch that clears every filter except the nav-link `type`. */
export function clearFiltersPatch(): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const name of CONTENT_FILTER_PARAMS) {
    if (name !== "type") patch[name] = null;
  }
  return patch;
}

/** The patch that applies a saved view: its params on top of a cleared filter set (the `type` stays). */
export function savedViewPatch(view: SavedView): Record<string, string | null> {
  return { ...clearFiltersPatch(), ...view.params };
}

/** True when the URL holds exactly the params of the view (and no other filter besides `type`). */
export function isSavedViewActive(view: SavedView, filters: Record<string, string>): boolean {
  for (const [name, value] of Object.entries(filters)) {
    if (name === "type") continue;
    if ((view.params[name] ?? "") !== value) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// CSV (client side, of the loaded rows)
// ---------------------------------------------------------------------------------------------

/* Spreadsheets run a cell that starts with = + - @ (or a tab / CR) as a formula, so text cells starting
 * that way get a leading apostrophe, as `csvRow` does in the API. Numbers and booleans cannot start one. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly CsvCell[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

export const CONTENT_CSV_HEADERS = [
  "id",
  "type",
  "locale",
  "slug",
  "title",
  "status",
  "live",
  "category",
  "author",
  "reviewer",
  "source",
  "scheduledAt",
  "publishedAt",
  "updatedAt",
  "wordCount",
  "blockingIssues",
  "warnings",
] as const;

/** The CSV of at most `CSV_EXPORT_CAP` rows. The header uses the stable English column ids. */
export function contentRowsToCsv(rows: readonly ContentItemSummary[]): string {
  let csv = "﻿" + csvRow(CONTENT_CSV_HEADERS);
  for (const row of rows.slice(0, CSV_EXPORT_CAP)) {
    csv += csvRow([
      row.id,
      row.type,
      row.locale,
      row.slug,
      row.title,
      row.status,
      row.live,
      row.category?.name,
      row.author?.name,
      row.reviewer?.name,
      row.source,
      row.scheduledAt,
      row.publishedAt,
      row.updatedAt,
      row.wordCount,
      row.issues.block,
      row.issues.warn,
    ]);
  }
  return csv;
}

// ---------------------------------------------------------------------------------------------
// Bulk results
// ---------------------------------------------------------------------------------------------

export interface BulkOutcome {
  id: string;
  ok: boolean;
  code?: string | undefined;
}

export interface BulkSummary {
  succeeded: number;
  failed: BulkOutcome[];
}

export function summariseBulk(results: readonly BulkOutcome[]): BulkSummary {
  return {
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok),
  };
}

/**
 * The sentence explaining a failed bulk item: this screen's own wording for the code, else the API's
 * message for an error code, else a generic line (a gate id or a code added later never leaves a hole).
 */
export function bulkErrorMessage(code: string | undefined): string {
  const generic = t("admin.content.error.unknown");
  if (!code) return generic;
  return tOr(`admin.content.error.${code}`, tOr(`error.${code}`, generic));
}

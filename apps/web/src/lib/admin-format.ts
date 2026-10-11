import { ar, t, type MessageKey } from "@wasfa/shared/i18n";

/*
 * Display helpers of the admin panel (DESIGN-SYSTEM §3.3, §4.6): Arabic wording with Western digits
 * (`numberingSystem: "latn"`), Gregorian dates. Only called from client components that render after
 * their data arrived and from server components that render once, so no hydration mismatch.
 */

const dateTime = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const numbers = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

export function formatDateTime(value: string | Date): string {
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

export function formatShortDate(value: string | Date): string {
  return dateOnly.format(typeof value === "string" ? new Date(value) : value);
}

export function formatNumber(value: number): string {
  return numbers.format(value);
}

/**
 * Translates a key built at run time (`admin.issue.explain.${code}`): a key the dictionary does not
 * have (a code added later) shows `fallback` instead of a hole.
 */
export function tOr(
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  return Object.hasOwn(ar, key) ? t(key as MessageKey, params) : fallback;
}

/** `2026-10-11` (a date input) as the start or end of that UTC day, as the audit API expects. */
export function dayBoundary(day: string, edge: "start" | "end"): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return edge === "start" ? `${day}T00:00:00.000Z` : `${day}T23:59:59.999Z`;
}

import { addDays, dayKey, monthGrid } from "./content-time";

import type { ContentItemSummary } from "@wasfa/shared/schemas/content";

/*
 * Pure model of the content calendar: which list queries cover a month, and how the loaded items
 * become one entry per (item, day) in the content time zone.
 */

export type CalendarEntryKind = "scheduled" | "published";

export interface CalendarEntry {
  key: string;
  kind: CalendarEntryKind;
  item: ContentItemSummary;
  /** The instant shown: `scheduledAt` or `publishedAt`. */
  at: string;
  /** The day in the content time zone. */
  day: string;
}

/** First and last day key the month grid shows (leading/trailing days of the neighbouring months). */
export function gridRange(month: string, weekStart: number): { first: string; last: string } {
  const weeks = monthGrid(month, weekStart);
  return { first: weeks[0]?.[0] ?? `${month}-01`, last: weeks.at(-1)?.[6] ?? `${month}-28` };
}

/**
 * The scheduled range to ask the API for. The API compares UTC days, the calendar shows zone days:
 * one day of slack on both sides guarantees nothing at the edge is missed; entries are then placed (and
 * clipped to the grid) by their zone day.
 */
export function scheduledQuery(month: string, weekStart: number): Record<string, string> {
  const { first, last } = gridRange(month, weekStart);
  return { scheduledFrom: addDays(first, -1), scheduledTo: addDays(last, 1) };
}

/** The same padded range for the published (live) items, by their publish time. */
export function publishedQuery(month: string, weekStart: number): Record<string, string> {
  const { first, last } = gridRange(month, weekStart);
  return { publishedFrom: addDays(first, -1), publishedTo: addDays(last, 1) };
}

/** Entries for the scheduled and the published items that fall inside the month grid. */
export function buildCalendarEntries(
  scheduled: readonly ContentItemSummary[],
  published: readonly ContentItemSummary[],
  timeZone: string,
  month: string,
  weekStart: number,
): CalendarEntry[] {
  const { first, last } = gridRange(month, weekStart);
  const entries: CalendarEntry[] = [];
  const seen = new Set<string>();
  const push = (kind: CalendarEntryKind, item: ContentItemSummary, at: string | null) => {
    if (at === null) return;
    const day = dayKey(at, timeZone);
    if (day < first || day > last) return;
    const key = `${kind}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ key, kind, item, at, day });
  };
  for (const item of scheduled) push("scheduled", item, item.scheduledAt);
  for (const item of published) push("published", item, item.publishedAt);
  return entries.toSorted((a, b) => a.at.localeCompare(b.at));
}

export function entriesByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const days = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const bucket = days.get(entry.day);
    if (bucket) bucket.push(entry);
    else days.set(entry.day, [entry]);
  }
  return days;
}

/** Days of the month (not of the neighbouring months) that have entries, ascending: the phone agenda. */
export function agendaDays(entries: readonly CalendarEntry[], month: string): string[] {
  return [...entriesByDay(entries).keys()].filter((day) => day.startsWith(month)).toSorted();
}

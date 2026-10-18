const monthFormat = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** «أكتوبر 2026» for `2026-10` (the API counts months in UTC). */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return monthFormat.format(new Date(Date.UTC(year ?? 1970, (number ?? 1) - 1, 1)));
}

/** `count` months ending with `current` (`YYYY-MM`), newest first. */
export function recentMonths(current: string, count = 12): string[] {
  const [year, number] = current.split("-").map(Number);
  const months: string[] = [];
  for (let back = 0; back < count; back += 1) {
    const date = new Date(Date.UTC(year ?? 1970, (number ?? 1) - 1 - back, 1));
    months.push(
      `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return months;
}

/** End of the chosen day in UTC, as the API's ISO timestamp; `""` (no date) means no expiry. */
export function endOfDayIso(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.000Z` : null;
}

/** The public link of a join slug on this site. */
export function joinUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/join/${slug}`;
}

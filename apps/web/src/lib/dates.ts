/*
 * Date display (DESIGN-SYSTEM §3 / §4.6): Gregorian, Arabic wording, Western digits. Only used in
 * client components that render after data arrives, so server and browser time zones never disagree
 * during hydration.
 */

const dateFormat = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatDate(value: string | Date): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

const dateTimeFormat = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Date and time in the visitor's own time zone: render it after mount only (client components). */
export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(typeof value === "string" ? new Date(value) : value);
}

const relativeFormat = new Intl.RelativeTimeFormat("ar-EG-u-nu-latn", { numeric: "auto" });

const STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "منذ 3 ساعات": the largest unit that fits; under a minute is "الآن". */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const seconds = Math.round(
    ((typeof value === "string" ? new Date(value) : value).getTime() - now.getTime()) / 1000,
  );
  const absolute = Math.abs(seconds);
  for (const [unit, size] of STEPS) {
    if (absolute >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return relativeFormat.format(0, "second");
}

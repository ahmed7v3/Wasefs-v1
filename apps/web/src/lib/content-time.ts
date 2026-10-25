/*
 * Calendar maths of the content admin, in one IANA time zone (the `content` setting, default
 * Africa/Cairo). Pure functions over `Intl`: no dates are formatted with the browser's own zone, so the
 * calendar, the saved views and the series scheduler agree with the zone the publishing cap uses.
 * Days are plain `YYYY-MM-DD` keys; arithmetic on them runs in UTC (a calendar day has no zone).
 */

export const DEFAULT_CONTENT_TIME_ZONE = "Africa/Cairo";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
}

/** True when the runtime knows the zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** The `YYYY-MM-DD` of an instant in the zone. */
export function dayKey(value: Date | string, timeZone: string): string {
  const parts = zonedParts(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** `HH:mm` of an instant in the zone. */
export function timeKey(value: Date | string, timeZone: string): string {
  const parts = zonedParts(typeof value === "string" ? new Date(value) : value, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function todayKey(timeZone: string, now: Date = new Date()): string {
  return dayKey(now, timeZone);
}

function parseDay(day: string): { year: number; month: number; day: number } | null {
  const match = DAY_KEY.exec(day);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `day` moved by `count` calendar days (negative goes back). */
export function addDays(day: string, count: number): string {
  const parsed = parseDay(day);
  if (!parsed) return day;
  const moved = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + count));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The offset (zone minus UTC) in milliseconds at an instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // `instant` has no sub-second part we care about; drop it so the difference is whole seconds.
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock of `timeZone` reads `local` (`YYYY-MM-DDTHH:mm`, a datetime-local
 * value). Two passes settle the offset across a daylight-saving change. `null` for a malformed value.
 */
export function zonedLocalToInstant(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return new Date(second);
}

/** The Saturday-first week of Arabic calendars; English weeks start on Sunday. 0 = Sunday. */
export function weekStartFor(locale: string): number {
  return locale.startsWith("ar") ? 6 : 0;
}

/** Day-of-week of a day key, 0 = Sunday. */
export function dayOfWeek(day: string): number {
  const parsed = parseDay(day);
  if (!parsed) return 0;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** The first day of the week (per `weekStart`) that contains `day`. */
export function startOfWeek(day: string, weekStart: number): string {
  const back = (dayOfWeek(day) - weekStart + 7) % 7;
  return addDays(day, -back);
}

/** `YYYY-MM` shifted by `count` months. */
export function shiftMonth(month: string, count: number): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, mon - 1 + count, 1));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}`;
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Weeks of day keys that cover the month, each week starting on `weekStart` (4 to 6 rows of 7). */
export function monthGrid(month: string, weekStart: number): string[][] {
  const first = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const last = addDays(next, -1);
  const gridStart = startOfWeek(first, weekStart);
  const gridEnd = addDays(startOfWeek(last, weekStart), 6);
  const weeks: string[][] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
  }
  return weeks;
}

/** Buckets items by the zone day of one of their instants; items without that instant are left out. */
export function groupByDay<T>(
  items: readonly T[],
  pick: (item: T) => string | null,
  timeZone: string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const instant = pick(item);
    if (instant === null) continue;
    const key = dayKey(instant, timeZone);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** A readable day label (`الأحد 25 أكتوبر`) for a day key. Western digits, like the rest of the admin. */
export function formatDayLabel(day: string, locale = "ar-EG"): string {
  const parsed = parseDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(locale, {
    numberingSystem: "latn",
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

export function formatMonthLabel(month: string, locale = "ar-EG"): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    numberingSystem: "latn",
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

export function formatWeekdayShort(day: string, locale = "ar-EG"): string {
  const parsed = parseDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(
    new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)),
  );
}

/** The day-of-month number of a day key. */
export function dayNumber(day: string): number {
  return parseDay(day)?.day ?? 0;
}

/** `25 أكتوبر 2026، 09:30` for an instant in the zone. */
export function formatZoned(value: Date | string, timeZone: string, locale = "ar-EG"): string {
  return new Intl.DateTimeFormat(locale, {
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

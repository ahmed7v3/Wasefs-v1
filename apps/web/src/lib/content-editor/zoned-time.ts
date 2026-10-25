/*
 * Schedule times are typed on a wall clock in the content time zone (`content.timeZone`, default
 * Africa/Cairo, which observes DST) and stored as UTC instants. The browser's own zone must never
 * leak in: an editor travelling or on a VPN schedules in Cairo time, as the settings page says.
 */

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in `timeZone`, as a UTC millisecond count (for offset arithmetic). */
function wallClockAsUtc(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
}

/** `timeZone`'s offset from UTC at `instant`, in milliseconds (positive = ahead of UTC). */
function offsetAt(instant: number, timeZone: string): number {
  return wallClockAsUtc(instant - (instant % 1000), timeZone) - (instant - (instant % 1000));
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** An instant as `YYYY-MM-DDTHH:mm` on the wall clock of `timeZone` (the value a datetime-local input takes). */
export function utcToZoned(instant: Date | string, timeZone: string): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  const wall = new Date(wallClockAsUtc(ms, timeZone));
  return `${String(wall.getUTCFullYear())}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/**
 * The UTC instant of a wall-clock string in `timeZone`; `null` for malformed input. Around a DST change:
 * a wall time that happens twice (clocks go back) resolves to the first occurrence, and a wall time that
 * never happens (clocks jump forward) resolves to the same clock reading after the jump, which is what
 * `Temporal`'s "compatible" mode does.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(guess)) return null;
  // Both neighbouring offsets are candidates; keep those that map back to the typed wall time.
  const DAY = 24 * 3_600_000;
  const before = offsetAt(guess - DAY, timeZone);
  const after = offsetAt(guess + DAY, timeZone);
  const candidates = [...new Set([guess - before, guess - after])].sort((a, b) => a - b);
  const wanted = local.slice(0, 16);
  const valid = candidates.filter(
    (candidate) => utcToZoned(new Date(candidate), timeZone) === wanted,
  );
  const chosen = valid[0] ?? guess - before;
  return new Date(chosen);
}

/** The smallest allowed schedule time (`now + minutes`, rounded up to a whole minute) as a wall-clock string. */
export function minScheduleLocal(now: Date, timeZone: string, minutes = 2): string {
  const rounded = Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000;
  return utcToZoned(new Date(rounded), timeZone);
}

/** An instant as «٢٤ أكتوبر ٢٠٢٦، ٢:٣٠ م» style text on the wall clock of `timeZone` (Western digits). */
export function formatZoned(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("ar-EG", {
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof instant === "string" ? new Date(instant) : instant);
}

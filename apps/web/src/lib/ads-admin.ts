import { parseAdSize } from "@wasfa/shared/ads";

/*
 * Pure helpers of the ads console (no React): percent text, the preview box, the schedule inputs
 * and the country list. Unit-tested in `test/admin-ads.test.tsx`.
 */

const percent = new Intl.NumberFormat("ar-EG", {
  numberingSystem: "latn",
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** CTR as a percent ("2.5%"); a rate of 0 reads "0%". */
export function formatCtr(ratio: number): string {
  return percent.format(Number.isFinite(ratio) ? ratio : 0).replace(/[\u200e\u200f]/g, "");
}

/** `WxH` as "970 × 250"; `native` and unparsable sizes read as written. */
export function sizeLabel(size: string): string {
  const parsed = parseAdSize(size);
  return parsed ? `${String(parsed.width)} × ${String(parsed.height)}` : size;
}

/** CSS aspect-ratio of a size (`native` cards are a 16:9 picture), for the live preview box. */
export function aspectOf(size: string): string {
  const parsed = parseAdSize(size);
  return parsed ? `${String(parsed.width)} / ${String(parsed.height)}` : "16 / 9";
}

/** ISO instant -> the value of an `<input type="datetime-local">` in the browser's time zone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The value of a `datetime-local` input -> an ISO instant, or null when empty or invalid. */
export function localInputToIso(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "eg, sa ae" -> ["EG", "SA", "AE"]: split on commas and spaces, upper-cased, de-duplicated. */
export function parseCountries(text: string): string[] {
  const codes = text
    .split(/[\s,،;]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== "");
  return [...new Set(codes)];
}

/** A shorter text for the link line of the WhatsApp bubble: host and path, no scheme. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** The 7-day default range label is computed by the API; the console only sends a channel. */
export function statsPath(channel: string): string {
  return channel === ""
    ? "/admin/ads/stats"
    : `/admin/ads/stats?channel=${encodeURIComponent(channel)}`;
}

/*
 * Display and input helpers of the WhatsApp agent admin pages. Money is stored as integer USD micros
 * (1 USD = 1,000,000); the admin types and reads dollars.
 */

const MICROS = 1_000_000;

/** `5000000` becomes `5.00`: what the cap field shows. */
export function usdTextFromMicros(micros: number): string {
  return (micros / MICROS).toFixed(2);
}

/** What the cap field holds back as micros; `NaN` for text that is not a non-negative amount. */
export function microsFromUsdText(text: string): number {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * MICROS);
}

/** Cost of a day or a total: two decimals, four for a few cents or less so it does not read as zero. */
export function formatUsdMicros(micros: number): string {
  const digits = micros > 0 && micros < 10_000 ? 4 : 2;
  return `$${(micros / MICROS).toFixed(digits)}`;
}

/** A media-list key (`^[a-z0-9][a-z0-9_-]*$`, 40 characters at most) made from a file name. */
export function mediaKeyFrom(name: string | null | undefined, taken: ReadonlySet<string>): string {
  const base =
    (name ?? "")
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "media";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

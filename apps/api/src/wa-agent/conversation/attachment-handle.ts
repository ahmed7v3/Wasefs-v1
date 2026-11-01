const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** `#3`, `3`, `"3"` and `#٣` all name handle 3; anything else is null. */
export function normalizeHandle(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : null;
  const ascii = raw.trim().replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
  const match = /^#?\s*(\d{1,6})$/.exec(ascii);
  const value = match === null ? 0 : Number(match[1]);
  return value > 0 ? value : null;
}

/** The handle as the customer, the prompt and the notes write it. */
export const formatHandle = (handle: number): string => `#${handle}`;

/** The first six characters of the analysis id: what the model and the notes call "rx#a1b2c3". */
export const rxRefOf = (rxId: string): string => rxId.slice(0, 6);

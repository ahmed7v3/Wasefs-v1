// Crockford base32 without I, L, O, U: nothing that is easy to misread when a user reads a ref aloud.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** UUIDv7 (RFC 9562): 48-bit unix-ms timestamp + random bits, so ids sort by creation time. */
export function newId(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = (now >>> 24) & 0xff;
  bytes[3] = (now >>> 16) & 0xff;
  bytes[4] = (now >>> 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const ERROR_REF_PATTERN = /^WSF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Support-friendly error reference, e.g. `WSF-7K2M-9QXD` (40 bits of randomness). */
export function newErrorRef(): string {
  // 32 symbols and 256 byte values divide evenly, so masking to 5 bits is unbiased.
  const chars = Array.from(randomBytes(8), (b) => CROCKFORD.charAt(b & 31));
  return `WSF-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function isErrorRef(value: unknown): value is string {
  return typeof value === "string" && ERROR_REF_PATTERN.test(value);
}

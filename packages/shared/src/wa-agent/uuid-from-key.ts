const HEX_KEY = /^[0-9a-f]{32,}$/;

/**
 * A UUID (RFC 9562 version 8, variant 10) built from the first 16 bytes of a lower-case hex key, so the
 * same tool call always means the same row id (docs/WA-AGENT-RUNTIME.md section 17.3).
 */
export function uuidFromKey(key: string): string {
  if (!HEX_KEY.test(key)) throw new Error("uuidFromKey needs a lower-case hex key of 32+ digits");
  const bytes = key.slice(0, 32).match(/../g) ?? [];
  bytes[6] = ((Number.parseInt(bytes[6] ?? "00", 16) & 0x0f) | 0x80).toString(16).padStart(2, "0");
  bytes[8] = ((Number.parseInt(bytes[8] ?? "00", 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

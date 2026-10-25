import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Stateless preview tokens (CONTENT-PLATFORM §4.4, §11.4). `/preview/<token>` renders a draft through the
 * real public template; the token proves an admin asked for it. Signed with HMAC-SHA256 over the payload,
 * short-lived, never stored: expiry is the only revocation, which is why the lifetime is a setting.
 * Node-only (node:crypto); the API signs and verifies, the web app only forwards the opaque string.
 */

export interface PreviewTokenPayload {
  itemId: string;
  /** Absent = preview the item's current (latest) revision. */
  revisionId?: string | undefined;
  /** Expiry, unix seconds. */
  expiresAt: number;
}

const SEPARATOR = ".";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const base64url = (bytes: Buffer | string): string => Buffer.from(bytes).toString("base64url");

function mac(secret: string, body: string): Buffer {
  // The label keeps this key apart from any other use of the same secret.
  return createHmac("sha256", `content-preview-v1:${secret}`).update(body).digest();
}

export function signPreviewToken(secret: string, payload: PreviewTokenPayload): string {
  const body = base64url(
    JSON.stringify({ i: payload.itemId, r: payload.revisionId, e: payload.expiresAt }),
  );
  return `${body}${SEPARATOR}${base64url(mac(secret, body))}`;
}

/** Returns the payload, or null for anything malformed, tampered with or expired. */
export function verifyPreviewToken(
  secret: string,
  token: string,
  now: Date,
): PreviewTokenPayload | null {
  if (token.length > 600) return null;
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const expected = mac(secret, body);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const { i, r, e } = raw as { i?: unknown; r?: unknown; e?: unknown };
    if (typeof i !== "string" || !UUID.test(i)) return null;
    if (r !== undefined && (typeof r !== "string" || !UUID.test(r))) return null;
    if (typeof e !== "number" || !Number.isInteger(e)) return null;
    if (e * 1000 <= now.getTime()) return null;
    return { itemId: i, revisionId: r, expiresAt: e };
  } catch {
    return null;
  }
}

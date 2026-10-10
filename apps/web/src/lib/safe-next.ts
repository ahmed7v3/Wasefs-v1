import { isSafeRedirect } from "@wasfa/shared/schemas/auth";

/** Where a signed-in user lands when `next` is missing or not trustworthy. */
export const DEFAULT_NEXT = "/dashboard";

const MAX_LENGTH = 2_048;
const PROBE_ORIGIN = "http://next.invalid";

/**
 * The post-login destination from a `?next=` parameter. Only same-origin relative paths pass, so a
 * crafted login link can never send a user to another site after they typed their password.
 * `isSafeRedirect` also accepts absolute http(s) URLs (the API gates those against its own origins),
 * which is not enough here: the browser would follow them.
 */
export function safeNext(value: string | string[] | null | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || candidate.length > MAX_LENGTH) return DEFAULT_NEXT;
  if (!candidate.startsWith("/") || !isSafeRedirect(candidate)) return DEFAULT_NEXT;

  // An encoded `//evil` or `/\evil` must fail the same checks once something downstream decodes it.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return DEFAULT_NEXT;
  }
  if (!decoded.startsWith("/") || !isSafeRedirect(decoded)) return DEFAULT_NEXT;

  // Final proof, using the same parser the browser uses: the target must stay on this origin.
  try {
    if (new URL(candidate, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
  return candidate;
}

import { REFERRAL_COOKIE, REFERRAL_HEADER, type ReferralSource } from "@wasfa/shared/rewards";

export interface ReferralHint {
  code: string;
  /** The register form's field is a typed code; the cookie comes from an invite link. */
  source: Extract<ReferralSource, "code" | "link">;
}

/** The value of one cookie in a `Cookie` header, or null. */
function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Where a new user's invite code came from, in order of trust: the register form's field (the auth
 * controller turns it into `x-wasfa-referral` after stripping any client copy), then the `wasfa_ref`
 * cookie set by `/r/<code>`. Nothing here validates the code: attribution looks it up and ignores
 * what it does not know.
 */
export function referralFromHeaders(headers: Headers | undefined): ReferralHint | null {
  if (!headers) return null;
  const typed = headers.get(REFERRAL_HEADER);
  if (typed !== null && typed.trim() !== "") return { code: typed, source: "code" };
  const cookie = cookieValue(headers.get("cookie"), REFERRAL_COOKIE);
  return cookie !== null && cookie !== "" ? { code: cookie, source: "link" } : null;
}

/*
 * First-party cookies the browser reads and writes itself (the workspace choice, the join slug, the
 * invite code). None holds a secret: they say which organization a person works for, which join
 * link or invite code they arrived with. The session cookie is HttpOnly and never touched here.
 */

const DAY_SECONDS = 24 * 60 * 60;

export interface CookieOptions {
  /** Lifetime in days. */
  days: number;
  secure?: boolean | undefined;
}

/** The `Set-Cookie`-style string for `document.cookie`; `SameSite=Lax` and `Path=/` always. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${String(Math.round(options.days * DAY_SECONDS))}`,
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** The value of one cookie in a `Cookie` header / `document.cookie` string, or `undefined`. */
export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function readBrowserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return parseCookie(document.cookie, name);
}

export function writeBrowserCookie(name: string, value: string, days: number): void {
  document.cookie = serializeCookie(name, value, {
    days,
    secure: window.location.protocol === "https:",
  });
}

export function clearBrowserCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/*
 * URL policy of the renderer (CONTENT-PLATFORM §11.3): a link may be `http(s)://…`, a site-relative
 * `/…` path or a `#…` anchor; everything else (javascript:, data:, vbscript:, mailto:, protocol-relative
 * `//host`, backslash tricks) is refused. Browsers drop tabs, newlines and other control characters
 * inside a URL before parsing it, so the check runs on the same stripped string the browser would see.
 */

// Built from code points so the source holds no invisible characters: C0 controls, space, DEL, C1 controls.
const CONTROL_AND_SPACE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x20)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  "g",
);

export type HrefClass =
  | { kind: "internal"; href: string }
  | { kind: "anchor"; href: string }
  | { kind: "external"; href: string; host: string }
  | { kind: "unsafe" };

export function classifyHref(raw: string): HrefClass {
  const href = raw.replace(CONTROL_AND_SPACE, "");
  if (href === "") return { kind: "unsafe" };
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (href.startsWith("/")) {
    // `//host` and `/\host` are protocol-relative to a browser.
    if (href.startsWith("//") || href.includes("\\")) return { kind: "unsafe" };
    return { kind: "internal", href };
  }
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.hostname === "" || url.username !== "" || url.password !== "")
        return { kind: "unsafe" };
      return { kind: "external", href: url.href, host: url.hostname.toLowerCase() };
    } catch {
      return { kind: "unsafe" };
    }
  }
  return { kind: "unsafe" };
}

/** `host` equals a listed domain or is a subdomain of one (`pubmed.ncbi.nlm.nih.gov` for `nih.gov`). */
export function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => {
    const d = domain.trim().toLowerCase();
    return d !== "" && (host === d || host.endsWith(`.${d}`));
  });
}

/** `rel` tokens of an external link: always noopener noreferrer; nofollow unless the host is trusted. */
export function externalRel(
  host: string,
  dofollowDomains: readonly string[],
  sponsored: boolean,
): string[] {
  const rel = ["noopener", "noreferrer"];
  if (sponsored) rel.push("sponsored");
  if (!hostMatches(host, dofollowDomains)) rel.push("nofollow");
  return rel;
}

/** The scheme+host(+port) of a URL such as the media origin, or null when it is not a valid http(s) origin. */
export function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** An absolute `src` or `srcset` candidate URL is allowed only when it lives under `mediaOrigin`. */
export function isUnderOrigin(url: string, mediaOrigin: string): boolean {
  const allowed = originOf(mediaOrigin);
  if (allowed === null) return false;
  const stripped = url.replace(CONTROL_AND_SPACE, "");
  if (stripped.startsWith("//") || stripped.includes("\\")) return false;
  return originOf(stripped) === allowed;
}

/** Candidate URLs of a `srcset` value (`url 320w, url 640w`). */
export function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter((url) => url !== "");
}

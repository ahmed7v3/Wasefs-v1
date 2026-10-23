import { PUBLIC_PAGES } from "./seo";

/*
 * Route templates for the first-party counters: a fixed, low-cardinality label per page, never the
 * concrete URL (no ids, no query). The shape must satisfy `routeTemplateSchema` of the API.
 */

const KNOWN_PATHS: ReadonlySet<string> = new Set(
  Object.values(PUBLIC_PAGES).flatMap((page) =>
    page.pathEn === null ? [page.path] : [page.path, page.pathEn],
  ),
);

export const OTHER_ROUTE = "/other";

// Sub-paths of an unknown tree share one label. The API's route pattern has no `*`, so the
// placeholder is `[rest]`.
const REST = "[rest]";
const SEGMENT = /^[a-z0-9_-]{1,40}$/;

function cleanPath(path: string): string {
  const bare = (path.split(/[?#]/)[0] ?? "").toLowerCase();
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare || "/";
}

/** The `PUBLIC_PAGES` path (Arabic or English) that `path` is, or `null` for any other path. */
export function publicPageTemplate(path: string): string | null {
  const clean = cleanPath(path);
  return KNOWN_PATHS.has(clean) ? clean : null;
}

/** Template of a page for the vitals beacon: a known public page, else `/other`. */
export function vitalsRoute(path: string): string {
  return publicPageTemplate(path) ?? OTHER_ROUTE;
}

/** Template of a crawled path: a known page, else first segment + `/[rest]` (e.g. `/blog/[rest]`), else `/other`. */
export function botRoute(path: string): string {
  const known = publicPageTemplate(path);
  if (known !== null) return known;
  const [first, second] = cleanPath(path).split("/").slice(1);
  if (first !== undefined && second !== undefined && SEGMENT.test(first)) {
    return `/${first}/${REST}`;
  }
  return OTHER_ROUTE;
}

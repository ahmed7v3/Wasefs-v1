import type { PageClass } from "@wasfa/shared/ads-class";

/*
 * Ad page class of a URL path, for the one ad that lives in a layout (the bottom banner): a layout
 * cannot read the `ad-class.ts` of the page under it, and it is not re-rendered on client navigation.
 * The table is deliberately small and DEFAULTS TO `app_sensitive` (never serves), so a new route
 * shows no banner until someone adds it here. `test/ad-route-class.test.ts` walks `src/app` and
 * fails when this table and a route's declared `adClass` disagree.
 */

const CONTENT_ROOTS = ["blog", "guides", "glossary", "authors"] as const;
const MARKETING_ROOTS = ["about", "features", "for"] as const;

export function adClassOfPath(rawPath: string): PageClass {
  const path = (rawPath.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  // The English routes live under `/en` and share the class of their Arabic twin.
  const segments = path
    .replace(/^\/en(?=\/|$)/, "")
    .split("/")
    .filter(Boolean);
  const [root] = segments;
  if (root === undefined) return "marketing";
  if ((MARKETING_ROOTS as readonly string[]).includes(root)) return "marketing";
  if ((CONTENT_ROOTS as readonly string[]).includes(root)) return "content";
  // Only the two app screens that declare `app_neutral`; /analyze/<id> (a result) is sensitive.
  if (segments.length === 1 && (root === "dashboard" || root === "analyze")) return "app_neutral";
  return "app_sensitive";
}

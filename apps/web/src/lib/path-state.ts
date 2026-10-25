import type { PublicPathState } from "@wasfa/shared/schemas/content";

/*
 * 301 / 410 for content URLs (CONTENT-PLATFORM §11.5). App Router pages cannot answer 410 or a
 * data-driven 301, so `proxy.ts` does, for the content prefixes only, from the API's path-state maps
 * kept in process for a minute. Pure lookup + a small refresh cache; no Next imports so it is unit-tested.
 */

const CONTENT_PREFIXES = ["/blog", "/guides", "/glossary", "/authors"] as const;

/** The RSS feeds live under /blog but are real routes, never redirected or gone. */
const EXCLUDED = new Set(["/blog/feed.xml", "/en/blog/feed.xml"]);

export const PATH_STATE_TTL_MS = 60_000;

function normalize(pathname: string): string {
  // Paths are stored exactly as `contentPath` builds them (lower-case slugs, no trailing slash):
  // only a trailing slash is folded away, case is NOT, so `/blog/X` never matches `/blog/x`.
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isContentPath(pathname: string): boolean {
  const path = normalize(pathname);
  if (EXCLUDED.has(path)) return false;
  const bare = path === "/en" || path.startsWith("/en/") ? path.slice(3) : path;
  return CONTENT_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

export type PathMatch = { kind: "redirect"; to: string } | { kind: "gone" } | null;

export function matchPathState(state: PublicPathState, pathname: string): PathMatch {
  const path = normalize(pathname);
  if (Object.hasOwn(state.redirects, path)) {
    const to = state.redirects[path];
    if (to !== undefined && to !== path) return { kind: "redirect", to };
  }
  return state.gone.includes(path) ? { kind: "gone" } : null;
}

export interface PathStateCache {
  /** The current maps, or `null` when none could be loaded yet. Never throws. */
  get(now?: number): Promise<PublicPathState | null>;
}

/**
 * TTL cache with one in-flight refresh. A failed refresh keeps the stale maps (or none: the request
 * then passes through to the page, which resolves the slug itself); it never blocks or fails a request.
 */
export function createPathStateCache(
  load: () => Promise<PublicPathState>,
  ttlMs = PATH_STATE_TTL_MS,
): PathStateCache {
  let state: PublicPathState | null = null;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  async function refresh(now: number): Promise<void> {
    try {
      state = await load();
      fetchedAt = now;
    } catch {
      // Back off for a short while so an API outage is not hammered once per request.
      fetchedAt = now - ttlMs + Math.min(5_000, ttlMs);
    }
  }

  return {
    async get(now = Date.now()) {
      if (now - fetchedAt >= ttlMs) {
        inFlight ??= refresh(now).finally(() => {
          inFlight = null;
        });
      }
      // A stale copy answers immediately while the refresh runs; only the very first call waits.
      if (state === null && inFlight !== null) await inFlight;
      return state;
    },
  };
}

const GONE_HTML: Record<"ar" | "en", string> = {
  ar: '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>تمت إزالة هذه الصفحة</title></head><body><h1>تمت إزالة هذه الصفحة</h1><p><a href="/">العودة إلى الرئيسية</a></p></body></html>',
  en: '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>This page has been removed</title></head><body><h1>This page has been removed</h1><p><a href="/en">Back to the home page</a></p></body></html>',
};

export function goneHtml(pathname: string): string {
  return GONE_HTML[pathname === "/en" || pathname.startsWith("/en/") ? "en" : "ar"];
}

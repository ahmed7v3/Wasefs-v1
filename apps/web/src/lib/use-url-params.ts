"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

export type ParamPatch = Record<string, string | null | undefined>;

/**
 * The query string as last written or read, shared by every hook instance: a filter bar has several
 * controls, and each must merge its change into what the others just wrote, not into a stale copy.
 */
const shared = { query: "" };

export interface UrlParams {
  /** The current value of a param, `""` when absent. */
  get: (name: string) => string;
  /** Sets (or, for `null`/`undefined`/`""`, removes) params and replaces the URL without scrolling. */
  update: (patch: ParamPatch) => void;
}

/**
 * The URL's query string as the single source of truth for admin filters and drawers (DESIGN-SYSTEM
 * §5.3): links are shareable and Back never replays every keystroke because updates use `replace`.
 * Updates are merged on a shared copy, so two changes made before the router answers (a debounced search
 * and a select) do not overwrite each other.
 */
export function useUrlParams(): UrlParams {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const serialized = search.toString();

  useEffect(() => {
    shared.query = serialized;
  }, [serialized]);

  const get = useCallback((name: string) => search.get(name) ?? "", [search]);

  const update = useCallback(
    (patch: ParamPatch) => {
      const next = new URLSearchParams(shared.query);
      for (const [name, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") next.delete(name);
        else next.set(name, value);
      }
      const query = next.toString();
      shared.query = query;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  return { get, update };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api-client";

import type { z } from "zod";

/*
 * Data loading of the admin pages. Everything is fetched in the browser with the signed-in user's
 * cookie (`api`), so filters in the URL need no server round trip and a write can refresh in place.
 * A reload keeps showing the previous data until the new answer arrives (no flash of skeletons).
 */

export type Resource<T> =
  { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; data: T };

export type ResourceHandle<T> = Resource<T> & { reload: () => void };

/** One GET, parsed with the shared response schema. `path: null` loads nothing (a closed drawer). */
export function useResource<S extends z.ZodType>(
  path: string | null,
  schema: S,
): ResourceHandle<z.output<S>> {
  const [state, setState] = useState<{ path: string | null; value: Resource<z.output<S>> }>({
    path,
    value: { status: "loading" },
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    // Same path and already loaded: this is a refresh, keep the data on screen.
    setState((current) =>
      current.path === path && current.value.status === "ready"
        ? current
        : { path, value: { status: "loading" } },
    );
    api(path, { schema, signal: controller.signal }).then(
      (data) => {
        setState({ path, value: { status: "ready", data } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ path, value: { status: "error", error } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [path, schema, tick]);

  const reload = useCallback(() => {
    setTick((current) => current + 1);
  }, []);

  // A state left over from another path is not an answer for this one.
  const value: Resource<z.output<S>> = state.path === path ? state.value : { status: "loading" };
  return { ...value, reload };
}

/** Builds a query string from filters, leaving out the empty ones: `{ q: "a", status: "" }` → `q=a`. */
export function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(name, value);
  }
  return query.toString();
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorList<T> {
  items: T[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
  error: unknown;
  loadingMore: boolean;
  /** Set when the last "load more" failed (the loaded rows stay). */
  loadMoreError: unknown;
  loadMore: () => void;
  reload: () => void;
}

/**
 * A keyset-paginated list (`{ items, nextCursor }`): the first page loads whenever `query` changes,
 * `loadMore` appends the page after `nextCursor`. There are no page numbers (the cursor is opaque).
 */
export function useCursorList<T>(
  path: string,
  query: string,
  schema: z.ZodType<Page<T>>,
): CursorList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<CursorList<T>["status"]>("loading");
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  // Which "generation" of the list a response belongs to: a late answer for an old filter is dropped.
  const generation = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const busy = useRef(false);
  // The first-page URL that produced the rows on screen: the same URL again is a refresh.
  const loadedUrl = useRef<string | null>(null);

  const url = useCallback(
    (cursor?: string) => {
      const parts = [query, cursor ? `cursor=${encodeURIComponent(cursor)}` : ""].filter(Boolean);
      return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
    },
    [path, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    const mine = ++generation.current;
    busy.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    const first = url();
    // Filters changed: show the skeleton. A plain reload keeps the rows while it refetches.
    if (loadedUrl.current !== first) setStatus("loading");
    api(first, { schema, signal: controller.signal }).then(
      (page) => {
        if (generation.current !== mine) return;
        loadedUrl.current = first;
        cursorRef.current = page.nextCursor;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(null);
        setStatus("ready");
      },
      (failure: unknown) => {
        if (controller.signal.aborted || generation.current !== mine) return;
        setError(failure);
        setStatus("error");
      },
    );
    return () => {
      controller.abort();
    };
    // `tick` is a deliberate dependency: `reload()` refetches the first page.
  }, [url, schema, tick]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (cursor === null || busy.current) return;
    busy.current = true;
    const mine = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    api(url(cursor), { schema }).then(
      (page) => {
        busy.current = false;
        if (generation.current !== mine) return;
        cursorRef.current = page.nextCursor;
        setItems((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
      (failure: unknown) => {
        busy.current = false;
        if (generation.current !== mine) return;
        setLoadMoreError(failure);
        setLoadingMore(false);
      },
    );
  }, [url, schema]);

  const reload = useCallback(() => {
    setTick((current) => current + 1);
  }, []);

  return { items, nextCursor, status, error, loadingMore, loadMoreError, loadMore, reload };
}

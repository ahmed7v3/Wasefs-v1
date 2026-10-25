"use client";

import { mediaListResponseSchema, type MediaAsset } from "@wasfa/shared/schemas/media";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api-client";
import { buildQuery } from "./use-admin-data";

export const MEDIA_PAGE_SIZE = 48;
/** While something is processing, the first page is re-read this often. */
export const MEDIA_REFRESH_MS = 4_000;

export interface MediaList {
  items: MediaAsset[];
  total: number;
  status: "loading" | "ready" | "error";
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** Re-reads the first page and merges it in (new uploads appear, changed assets update in place). */
  refresh: () => void;
  /** Replaces one asset in the loaded list (after a save). */
  replace: (asset: MediaAsset) => void;
}

/** Merges a fresh first page into the loaded items: known ids update in place, new ones go first. */
export function mergeFirstPage(
  current: readonly MediaAsset[],
  fresh: readonly MediaAsset[],
): MediaAsset[] {
  const freshById = new Map(fresh.map((asset) => [asset.id, asset]));
  const known = new Set(current.map((asset) => asset.id));
  const added = fresh.filter((asset) => !known.has(asset.id));
  return [...added, ...current.map((asset) => freshById.get(asset.id) ?? asset)];
}

/** Page-numbered media list (`GET /admin/media`) with "load more" and a refresh that follows processing. */
export function useMediaList(status: string): MediaList {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<MediaList["status"]>("loading");
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = useRef(1);
  const generation = useRef(0);

  const url = useCallback(
    (pageNumber: number) =>
      `/admin/media?${buildQuery({ status, page: String(pageNumber), pageSize: String(MEDIA_PAGE_SIZE) })}`,
    [status],
  );

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    page.current = 1;
    setState("loading");
    api(url(1), { schema: mediaListResponseSchema, signal: controller.signal }).then(
      (answer) => {
        if (generation.current !== mine) return;
        setItems(answer.items);
        setTotal(answer.total);
        setError(null);
        setState("ready");
      },
      (failure: unknown) => {
        if (controller.signal.aborted || generation.current !== mine) return;
        setError(failure);
        setState("error");
      },
    );
    return () => {
      controller.abort();
    };
  }, [url]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    api(url(page.current + 1), { schema: mediaListResponseSchema }).then(
      (answer) => {
        if (generation.current !== mine) return;
        page.current += 1;
        setItems((current) => {
          const known = new Set(current.map((asset) => asset.id));
          return [...current, ...answer.items.filter((asset) => !known.has(asset.id))];
        });
        setTotal(answer.total);
        setLoadingMore(false);
      },
      () => {
        setLoadingMore(false);
      },
    );
  }, [url, loadingMore]);

  const refresh = useCallback(() => {
    const mine = generation.current;
    api(url(1), { schema: mediaListResponseSchema }).then(
      (answer) => {
        if (generation.current !== mine) return;
        setItems((current) => mergeFirstPage(current, answer.items));
        setTotal(answer.total);
      },
      () => {
        /* a failed background refresh keeps what is on screen */
      },
    );
  }, [url]);

  const replace = useCallback((asset: MediaAsset) => {
    setItems((current) => current.map((item) => (item.id === asset.id ? asset : item)));
  }, []);

  const waiting = items.some((asset) => asset.status === "processing" || asset.status === "staged");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(refresh, MEDIA_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, refresh]);

  return {
    items,
    total,
    status: state,
    error,
    hasMore: items.length < total,
    loadingMore,
    loadMore,
    refresh,
    replace,
  };
}

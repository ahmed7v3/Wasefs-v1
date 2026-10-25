"use client";

import { useSyncExternalStore } from "react";

/** `window.matchMedia(query).matches`, live. Server and first client render answer `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => {
        list.removeEventListener("change", notify);
      };
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

/** Tailwind's `lg` (1024 px): the three-zone desktop layout. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
/** Tailwind's `xl` (1280 px): room for the split live preview. */
export const WIDE_QUERY = "(min-width: 1280px)";

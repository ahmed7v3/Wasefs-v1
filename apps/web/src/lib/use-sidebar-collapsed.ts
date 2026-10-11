"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Remembered per browser: the sidebar is a personal layout preference, not account data. */
export const SIDEBAR_STORAGE_KEY = "wasfa.sidebar";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the preference.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/**
 * Whether the desktop sidebar is collapsed to its 72 px rail. The server (and the first client
 * render) assume "expanded"; React then re-renders with the stored value, with no hydration mismatch.
 */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const setCollapsed = useCallback((next: boolean) => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      /* storage blocked: the choice is simply not remembered */
    }
    listeners.forEach((listener) => {
      listener();
    });
  }, []);
  return [collapsed, setCollapsed];
}

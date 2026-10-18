"use client";

import { publicEnv } from "./env";

import type { GrowthEventName } from "@wasfa/shared/growth";

/*
 * First-party funnel events (GROWTH §9) from the browser: a per-tab session id, events batched for
 * a moment and sent with `keepalive` so a page change does not lose them. Only ids, keys and small
 * numbers ever go in `props`; the API drops anything that looks personal. Failures are silent:
 * measuring must never break a page.
 */

const SESSION_KEY = "wasfa_gs";
const FLUSH_MS = 1_500;
const MAX_BATCH = 20;

type Props = Record<string, string | number | boolean>;
interface QueuedEvent {
  name: GrowthEventName;
  sessionId: string;
  props: Props;
}

let queue: QueuedEvent[] = [];
let timer: number | null = null;

/** The tab's session id (sessionStorage), created on first use; a fresh one when storage is blocked. */
export function growthSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = `w-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return `w-${crypto.randomUUID()}`;
  }
}

function flush(): void {
  timer = null;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  if (batch.length === 0) return;
  void fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/growth/events`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ events: batch }),
  }).catch(() => undefined);
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (timer !== null) return;
  timer = window.setTimeout(flush, FLUSH_MS);
}

/** Queues one event; `immediate` sends at once (before a navigation that unloads the page). */
export function trackGrowth(name: GrowthEventName, props: Props = {}, immediate = false): void {
  if (typeof window === "undefined") return;
  queue.push({ name, sessionId: growthSessionId(), props });
  if (immediate) {
    if (timer !== null) window.clearTimeout(timer);
    flush();
    return;
  }
  schedule();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (queue.length > 0) flush();
  });
}

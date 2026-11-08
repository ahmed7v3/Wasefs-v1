"use client";

import { AD_IMPRESSION_BATCH_MAX } from "@wasfa/shared/ads";
import { useEffect, useRef, type ReactNode } from "react";

/*
 * The viewability beacon (docs/ADS.md §5): an impression is "50 % of the slot visible for 1 second".
 * It sends only the signed slot token, in batches, to a same-origin route. No cookie, no visitor id,
 * no page URL. Tokens are queued at module level so one request carries every slot of the page.
 */

const VISIBLE_RATIO = 0.5;
const DWELL_MS = 1_000;
const FLUSH_DELAY_MS = 2_000;
const ENDPOINT = "/api/ads/i";

const queue = new Set<string>();
const sent = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
  const tokens = [...queue].slice(0, AD_IMPRESSION_BATCH_MAX);
  if (tokens.length === 0) return;
  for (const token of tokens) queue.delete(token);
  const body = JSON.stringify({ tokens });
  // `text/plain` keeps `sendBeacon` free of a preflight; the route parses the text itself.
  if (!navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) {
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => undefined);
  }
  if (queue.size > 0) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function enqueue(token: string): void {
  if (sent.has(token)) return;
  sent.add(token);
  queue.add(token);
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

export function AdBeacon({ token, children }: { token: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            dwell ??= setTimeout(() => {
              enqueue(token);
              observer.disconnect();
            }, DWELL_MS);
          } else if (dwell !== undefined) {
            clearTimeout(dwell);
            dwell = undefined;
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    observer.observe(element);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      if (dwell !== undefined) clearTimeout(dwell);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [token]);

  return <div ref={ref}>{children}</div>;
}

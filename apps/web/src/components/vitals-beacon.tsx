"use client";

import { useEffect } from "react";

/** Share of page views that report (decided once per load, before anything is downloaded). */
const SAMPLE_RATE = 0.25;

/**
 * First-party field data (phase4 WP1 §2.6): on a sampled page view, loads `web-vitals` after the
 * page and an idle moment, and sends what it measured in one `sendBeacon` when the page is hidden.
 * Only the route template and metric values leave the browser: no ids, URL, cookies or user data.
 * `route` and `endpoint` come from the server so this stays free of env and routing code.
 */
export function VitalsBeacon({ route, endpoint }: { route: string; endpoint: string }) {
  useEffect(() => {
    if (Math.random() >= SAMPLE_RATE) return;
    const metrics = new Map<string, number>();
    let active = true;
    const send = () => {
      if (document.visibilityState !== "hidden" || metrics.size === 0) return;
      const body = [...metrics].map(([name, value]) => ({ name, value, route }));
      metrics.clear();
      navigator.sendBeacon(endpoint, JSON.stringify({ metrics: body }));
    };
    const start = () => {
      import("web-vitals")
        .then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
          if (!active) return;
          const record = ({ name, value }: { name: string; value: number }) => {
            metrics.set(name, value);
          };
          for (const observe of [onLCP, onINP, onCLS, onFCP, onTTFB]) observe(record);
          // Registered after the library's own listeners, so its final values are in by then.
          document.addEventListener("visibilitychange", send);
        })
        .catch(() => undefined);
    };
    const idle = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(start);
      else setTimeout(start, 1_000);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      active = false;
      window.removeEventListener("load", idle);
      document.removeEventListener("visibilitychange", send);
    };
  }, [route, endpoint]);
  return null;
}

"use client";

import { useEffect } from "react";

/**
 * The single client island behind every `Reveal` on a page. Blocks already in view stay as rendered (no
 * hide-then-show flash); the ones below the fold are hidden here and shown when they scroll into view.
 */
export function RevealObserver() {
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            if (el.dataset["ev"] === "hidden") el.dataset["ev"] = "shown";
            io.unobserve(el);
          } else if (el.dataset["ev"] === undefined) {
            el.dataset["ev"] = "hidden";
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of document.querySelectorAll("[data-reveal]")) io.observe(el);
    return () => io.disconnect();
  }, []);
  return null;
}

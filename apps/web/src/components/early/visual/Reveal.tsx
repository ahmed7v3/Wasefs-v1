"use client";

import { useLayoutEffect, useRef, type ElementType, type ReactNode } from "react";
import "./early-visual.css";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms. */
  delay?: number;
  as?: ElementType;
};

/**
 * SSR renders fully visible. The hidden state is applied in a layout effect
 * (before first paint) so no-JS / pre-hydration users never see blank content.
 */
export function Reveal({ children, className, delay = 0, as }: RevealProps) {
  const Tag: ElementType = as ?? "div";
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") {
      return;
    }
    el.dataset.ev = "hidden";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.ev = "shown";
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // CSP forbids inline style attributes: map the delay to a fixed 80ms-step class.
  const step = Math.min(8, Math.max(0, Math.round(delay / 80)));
  return (
    <Tag ref={ref} className={`ev-reveal ev-d-${step}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}

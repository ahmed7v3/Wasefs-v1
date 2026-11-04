"use client";

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ElementType, type ReactNode } from "react";
import "./early-visual.css";

type GlassProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  /** Corner radius in px (default 24). */
  radius?: number;
};

const noopSubscribe = () => () => undefined;

/** SVG-referencing backdrop-filter only actually refracts in Chromium; elsewhere we keep plain blur. */
function supportsRefraction(): boolean {
  if (typeof CSS === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Chromium\//.test(ua) && !/Firefox\//.test(ua);
  return chromium && CSS.supports("backdrop-filter", "url(#x) blur(1px)");
}

function useRefraction(): boolean {
  return useSyncExternalStore(noopSubscribe, supportsRefraction, () => false);
}

function RefractionFilter({ id }: { id: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="ev-glass-svg">
      <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

function useGlass(radius: number) {
  const raw = useId();
  const id = `evg${raw.replace(/:/g, "")}`;
  const refract = useRefraction();
  const ref = useRef<HTMLElement>(null);
  // CSP forbids inline style attributes; CSSOM writes are allowed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ev-glass-radius", `${radius}px`);
    if (refract) el.style.setProperty("--ev-glass-filter", `url(#${id}) blur(18px) saturate(180%)`);
    else el.style.removeProperty("--ev-glass-filter");
  }, [radius, refract, id]);
  return { id, refract, ref };
}

export function GlassSurface({ as, className, children, radius = 24 }: GlassProps) {
  const Tag: ElementType = as ?? "div";
  const { id, refract, ref } = useGlass(radius);
  return (
    <Tag className={`ev-glass${className ? ` ${className}` : ""}`} ref={ref}>
      {refract ? <RefractionFilter id={id} /> : null}
      {children}
    </Tag>
  );
}

/** Pill-shaped glass with a light glint sweeping across every ~6 s. */
export function GlassBadge({ as, className, children }: Omit<GlassProps, "radius">) {
  const Tag: ElementType = as ?? "span";
  const { id, refract, ref } = useGlass(999);
  return (
    <Tag className={`ev-glass ev-glass-badge${className ? ` ${className}` : ""}`} ref={ref}>
      {refract ? <RefractionFilter id={id} /> : null}
      <span className="ev-glass-glint" aria-hidden="true" />
      {children}
    </Tag>
  );
}

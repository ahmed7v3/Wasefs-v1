import type { ElementType, ReactNode } from "react";
import "./early-visual.css";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms. */
  delay?: number;
  as?: ElementType;
};

/**
 * Server component: it only marks the block. SSR renders it fully visible; the one `RevealObserver` island
 * on the page hides the blocks that are below the fold and shows them when they scroll in. (Each block used
 * to be its own client component, ~40 islands hydrated before the first paint of the home page.)
 */
export function Reveal({ children, className, delay = 0, as }: RevealProps) {
  const Tag: ElementType = as ?? "div";
  // CSP forbids inline style attributes: map the delay to a fixed 80ms-step class.
  const step = Math.min(8, Math.max(0, Math.round(delay / 80)));
  return (
    <Tag data-reveal="" className={`ev-reveal ev-d-${step}${className ? ` ${className}` : ""}`}>
      {children}
    </Tag>
  );
}

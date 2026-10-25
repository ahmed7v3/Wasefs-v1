"use client";

import { useEffect, useState } from "react";

/*
 * Height of the on-screen keyboard, from the Visual Viewport API. On iOS (and Android Chrome with
 * `interactive-widget=resizes-visual`) the keyboard covers the layout viewport instead of resizing it,
 * so a `position: fixed; bottom: 0` toolbar would sit BEHIND the keyboard. The visual viewport shrinks
 * from the bottom, so `layoutHeight - visualHeight - offsetTop` is the covered strip.
 */

export interface ViewportLike {
  height: number;
  offsetTop: number;
}

export function computeKeyboardInset(layoutHeight: number, viewport: ViewportLike): number {
  const covered = layoutHeight - viewport.height - viewport.offsetTop;
  return Number.isFinite(covered) ? Math.max(0, Math.round(covered)) : 0;
}

interface VisualViewportLike extends ViewportLike {
  addEventListener: (type: "resize" | "scroll", listener: () => void) => void;
  removeEventListener: (type: "resize" | "scroll", listener: () => void) => void;
}

export interface KeyboardInset {
  /** Pixels the keyboard covers at the bottom; 0 when closed, inactive or unsupported. */
  inset: number;
  /** False when the browser has no Visual Viewport API: callers fall back to a sticky bottom bar. */
  supported: boolean;
}

/** Tracks the keyboard only while `active` (the textarea is focused); nothing listens otherwise. */
export function useKeyboardInset(active: boolean): KeyboardInset {
  const [inset, setInset] = useState(0);
  const viewport: VisualViewportLike | null =
    typeof window === "undefined" ? null : (window.visualViewport as VisualViewportLike | null);
  const supported = viewport !== null && viewport !== undefined;

  useEffect(() => {
    const vv = window.visualViewport as VisualViewportLike | null;
    if (!active || !vv) {
      setInset(0);
      return;
    }
    const update = (): void => {
      setInset(computeKeyboardInset(window.innerHeight, vv));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  return { inset, supported };
}

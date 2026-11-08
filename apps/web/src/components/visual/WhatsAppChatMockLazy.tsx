"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";

const WhatsAppChatMock = dynamic(
  () => import("./WhatsAppChatMock").then((module) => module.WhatsAppChatMock),
  { ssr: false },
);

/**
 * Below the fold and purely decorative (its wrapper is `aria-hidden`): the animation code is a separate chunk
 * that is only requested when the placeholder is about to scroll into view, so the first load of `/` and
 * `/en` does not pay for it. The placeholder reserves the mock's height.
 */
export function WhatsAppChatMockLazy(props: ComponentProps<typeof WhatsAppChatMock>) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return near ? <WhatsAppChatMock {...props} /> : <div ref={ref} className="min-h-[28rem]" />;
}

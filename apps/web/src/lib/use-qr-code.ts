"use client";

import { useEffect, useState } from "react";

/**
 * A QR code of `text` as an SVG data URL (`img-src` allows `data:`), generated in the browser only,
 * so the text (a TOTP secret) never goes to any server. `undefined` until it is ready or if it fails:
 * callers always show the text form too.
 */
export function useQrCode(text: string | undefined, width = 208): string | undefined {
  const [source, setSource] = useState<{ text: string; url: string } | null>(null);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    void import("qrcode")
      .then((qr) => qr.toString(text, { type: "svg", margin: 1, width }))
      .then((svg) => {
        if (!cancelled) {
          setSource({ text, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
        }
      })
      .catch(() => {
        // No QR is fine: the manual key is the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [text, width]);

  return source !== null && source.text === text ? source.url : undefined;
}

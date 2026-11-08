"use client";

import { canServeOnClass, type PageClass } from "@wasfa/shared/ads-class";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { adClassOfPath } from "../../lib/ad-route-class";

import { AdBeacon } from "./ad-beacon";

import type { AdSlotView } from "@wasfa/shared/ads";

/** localStorage key of the dismissal: epoch milliseconds until which the banner stays closed. */
export const BANNER_CLOSED_KEY = "adBannerClosedUntil";
const DAY_MS = 24 * 60 * 60 * 1000;

/** True while a stored `adBannerClosedUntil` is still in the future; any storage failure reads as "open". */
export function isBannerClosed(now = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(BANNER_CLOSED_KEY);
    const until = raw === null ? 0 : Number(raw);
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

function rememberClosed(days: number, now = Date.now()): void {
  try {
    window.localStorage.setItem(BANNER_CLOSED_KEY, String(now + days * DAY_MS));
  } catch {
    // Private mode or blocked storage: the banner is closed for this page view only.
  }
}

export interface BottomBannerProps {
  slot: AdSlotView;
  /** The class the server rendered the banner for; the banner hides on any other class. */
  pageClass: PageClass;
  label: string;
  closeLabel: string;
}

/**
 * The closable bottom banner (docs/ADS.md, openspec ads/placements). Fixed at the bottom with the
 * safe-area inset, labelled by code, closed with one 44 px tap that is remembered for the admin-set
 * number of days on this device. It never covers content: an equal-height spacer is appended to the
 * page while it is shown. It renders nothing while closed, before storage is read (so a closed
 * banner never flashes), and on any route whose class is not the one it was rendered for or never
 * serves ads (the layout survives client navigation to e.g. /checkout). There is no slide animation,
 * so reduced-motion needs no special case.
 */
export function BottomBanner({ slot, pageClass, label, closeLabel }: BottomBannerProps) {
  const pathname = usePathname();
  const [state, setState] = useState<"unknown" | "open" | "closed">("unknown");

  useEffect(() => {
    setState(isBannerClosed() ? "closed" : "open");
  }, []);

  const routeClass = adClassOfPath(pathname);
  const allowed = canServeOnClass(routeClass) && routeClass === pageClass;
  if (state !== "open" || !allowed) return null;

  const { creative } = slot;
  return (
    <>
      <aside
        aria-label={label}
        data-ad-placement={slot.placement}
        data-testid="bottom-banner"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-raised"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-2 py-1">
          <div className="min-w-0 flex-1">
            <AdBeacon token={slot.token}>
              <a
                href={`/a/${slot.token}`}
                rel="sponsored noopener"
                className="flex items-center gap-3 rounded-md"
              >
                <span className="shrink-0 text-xs text-text-muted">{label}</span>
                {creative.image ? (
                  <span className="relative block h-12 w-full max-w-[728px] overflow-hidden rounded-md md:h-[90px]">
                    {/* A plain img: next/image would add ~13 KB gzip to every public page, and an
                        unoptimized first-party creative gains nothing from it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={creative.image.url}
                      alt={creative.alt}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 size-full object-contain"
                    />
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                    {creative.title}
                  </span>
                )}
              </a>
            </AdBeacon>
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => {
              rememberClosed(slot.dismissDays);
              setState("closed");
            }}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </aside>
      {/* Equal height at the end of the page, so the last lines are never under the fixed banner. */}
      <div
        aria-hidden
        data-testid="bottom-banner-spacer"
        className="h-[calc(3.5rem+env(safe-area-inset-bottom))] md:h-[calc(6.25rem+env(safe-area-inset-bottom))]"
      />
    </>
  );
}

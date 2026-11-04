import { early } from "../../content/early";
import { formatCount } from "../../lib/early-stats";
import { SiteBrandMark } from "../site-brand-mark";

import { GlassSurface } from "./visual/GlassSurface";

/**
 * Sticky liquid-glass header. `home` is true on the landing page itself (plain `#anchors`); the
 * privacy page links back to `/early#...`, which works on the subdomain and on the main host.
 */
export function EarlyHeader({ joined, home = true }: { joined: number | null; home?: boolean }) {
  const base = home ? "" : "/early";
  const link =
    "hidden min-h-11 items-center rounded-full px-4 text-[15px] font-semibold text-[#0b1220]/80 transition-colors hover:bg-[#0b1220]/5 hover:text-[#1e3a8a] focus-visible:outline-none focus-visible:shadow-focus md:inline-flex";
  return (
    <div className="sticky top-2 z-40 px-3 pt-2 sm:top-3 sm:px-5">
      <GlassSurface as="header" radius={28} className="early-header mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 sm:px-4">
          <SiteBrandMark />
          <nav aria-label={early.header.navLabel} className="flex items-center gap-1 sm:gap-2">
            <a href={`${base}#how-it-works`} className={link}>
              {early.header.how}
            </a>
            <a href={`${base}#features`} className={link}>
              {early.header.features}
            </a>
            <a href={`${base}#faq`} className={link}>
              {early.header.faq}
            </a>
            {joined !== null ? (
              <span
                // Live proof of life; hidden below `sm` where the pill needs the room.
                className="hidden min-h-9 items-center gap-2 rounded-full bg-white/70 px-3 text-sm font-semibold tabular-nums text-[#1e3a8a] ring-1 ring-[#1e3a8a]/10 sm:inline-flex"
              >
                <span aria-hidden="true" className="early-live size-2 rounded-full bg-[#2563eb]" />
                {early.header.counter(formatCount(joined))}
              </span>
            ) : null}
            <a
              href={`${base}#join`}
              className="inline-flex min-h-11 items-center rounded-full bg-[#1e3a8a] px-5 text-[15px] font-bold text-white shadow-[0_6px_16px_-6px_rgb(30_58_138/0.7)] transition-colors hover:bg-[#172e6e] focus-visible:outline-none focus-visible:shadow-focus"
            >
              {early.header.cta}
            </a>
          </nav>
        </div>
      </GlassSurface>
    </div>
  );
}

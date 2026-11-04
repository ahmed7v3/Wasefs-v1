import Link from "next/link";

import { early } from "../../content/early";
import { publicEnv } from "../../lib/env";

const footerLink =
  "inline-flex min-h-11 items-center text-[#0b1220]/80 underline-offset-4 hover:text-[#1e3a8a] hover:underline focus-visible:outline-none focus-visible:shadow-focus";

export function EarlyFooter() {
  const { footer } = early;
  return (
    <footer className="border-t border-[#0b1220]/8 px-5 py-12 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 text-[15px] font-semibold">
          <span className="font-heading text-lg font-bold text-[#1e3a8a]">{early.brand}</span>
          <nav className="flex flex-wrap items-center gap-x-6" aria-label={footer.privacy}>
            <Link href="/early/privacy" className={footerLink}>
              {footer.privacy}
            </Link>
            <a href={publicEnv.NEXT_PUBLIC_SITE_URL} className={footerLink}>
              {footer.main}
            </a>
          </nav>
        </div>
        <p className="max-w-[65ch] text-sm leading-[1.9] text-[#4a5670]">{footer.disclaimer}</p>
        <p className="text-sm font-semibold text-[#4a5670]">{footer.madeWith}</p>
      </div>
    </footer>
  );
}

import { Check } from "lucide-react";
import Link from "next/link";

import { early } from "../../../../content/early";
import { EARLY_ORIGIN } from "../../../../lib/early-host";
import { isProduction, publicEnv } from "../../../../lib/env";
import { getPublicSettings } from "../../../../lib/public-settings";

import type { Metadata } from "next";

const page = early.privacyPage;

const contactLink =
  "text-[#1e3a8a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus";

export function generateMetadata(): Metadata {
  const url = `${EARLY_ORIGIN}/privacy`;
  return {
    metadataBase: new URL(EARLY_ORIGIN),
    title: { absolute: `${page.title} | ${early.brand}` },
    description: page.description,
    alternates: { canonical: url },
    robots: isProduction ? { index: true, follow: true } : { index: false, follow: false },
  };
}

/** What the pre-launch page collects, in plain words (EARLY-ACCESS-PLAN D2: collected silently, never hidden). */
export default async function EarlyPrivacyPage() {
  const { contact } = await getPublicSettings();
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      <h1 className="text-[clamp(1.9rem,1.2rem+2.6vw,3rem)] font-bold leading-[1.3]">
        {page.title}
      </h1>
      <p className="mt-5 max-w-[65ch] text-lg leading-[1.9] text-[#0b1220]/75">{page.intro}</p>

      <h2 className="mt-12 text-2xl font-bold">{page.collected.title}</h2>
      <ul className="mt-5 space-y-3">
        {page.collected.items.map((item) => (
          <li key={item} className="flex items-start gap-3 text-[17px] leading-[1.85]">
            <span className="mt-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#1e3a8a] text-white">
              <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
            </span>
            <span className="max-w-[65ch]">{item}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-2xl font-bold">{page.why.title}</h2>
      <p className="mt-3 max-w-[65ch] text-[17px] leading-[1.9] text-[#0b1220]/75">
        {page.why.body}
      </p>

      <h2 className="mt-12 text-2xl font-bold">{page.deletion.title}</h2>
      <p className="mt-3 max-w-[65ch] text-[17px] leading-[1.9] text-[#0b1220]/75">
        {page.deletion.body}
      </p>
      <p className="mt-3 text-[17px] font-semibold">
        {page.contactLabel}:{" "}
        {contact.email ? (
          <a href={`mailto:${contact.email}`} dir="ltr" className={contactLink}>
            {contact.email}
          </a>
        ) : (
          // No public email configured: the main site's contact page is the way in.
          <a href={`${publicEnv.NEXT_PUBLIC_SITE_URL}/contact`} className={contactLink}>
            {page.contactPage}
          </a>
        )}
      </p>

      <p className="mt-14">
        <Link
          href="/early"
          className="inline-flex min-h-12 items-center rounded-2xl bg-[#1e3a8a] px-7 font-bold text-white transition-colors hover:bg-[#172e6e] focus-visible:outline-none focus-visible:shadow-focus"
        >
          {page.back}
        </Link>
      </p>
    </article>
  );
}

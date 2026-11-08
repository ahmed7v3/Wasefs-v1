import { Languages, Lock, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { type TrustIcon } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";
import { Reveal } from "../visual/Reveal";

import { HOME_FOCUS, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";

const ICONS = {
  shield: ShieldCheck,
  lock: Lock,
  stethoscope: Stethoscope,
  languages: Languages,
} as const satisfies Record<TrustIcon, unknown>;

/** Privacy and trust: the navy band of the page, light text on translucent cards. */
export function TrustSection({ locale = "ar" }: { locale?: Locale }) {
  const { trust } = landingFor(locale);
  return (
    <HomeSection
      labelledBy="trust-title"
      className="bg-linear-to-br from-[#0b1220] to-primary text-on-primary"
    >
      <HomeHeading id="trust-title" title={trust.title} lead={trust.lead} dark />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {trust.items.map((item, index) => {
          const Icon = ICONS[item.icon];
          return (
            <Reveal key={item.title} as="li" delay={(index % 4) * 70}>
              <div className="h-full rounded-[26px] bg-white/8 p-6 ring-1 ring-white/15 backdrop-blur-sm">
                <span className="grid size-12 place-items-center rounded-2xl bg-white/15 text-white">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <h3 className="mt-4 text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-base leading-[1.8] text-white/85">{item.body}</p>
              </div>
            </Reveal>
          );
        })}
      </ul>
      <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
        <Link
          href="/privacy"
          className={`inline-flex min-h-12 items-center justify-center rounded-2xl bg-white px-6 text-base font-bold text-primary transition-colors duration-150 hover:bg-primary-soft ${HOME_FOCUS}`}
        >
          {trust.privacyLink}
        </Link>
        <Link
          href="/disclaimer"
          className={`inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/50 px-6 text-base font-bold text-white transition-colors duration-150 hover:bg-white/10 ${HOME_FOCUS}`}
        >
          {trust.disclaimerLink}
        </Link>
      </div>
    </HomeSection>
  );
}

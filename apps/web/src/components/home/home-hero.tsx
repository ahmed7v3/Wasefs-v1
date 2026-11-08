import { buttonStyles } from "@wasfa/ui";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { GlassBadge } from "../visual/GlassSurface";
import { HaloBackdrop } from "../visual/HaloBackdrop";
import { Reveal } from "../visual/Reveal";
import { WasfaCharacter } from "../visual/WasfaCharacter";

import type { Locale } from "../../lib/locale";
import type { ReactNode } from "react";

/**
 * First screen in the early-access look. The H1 is plain server-rendered text (never wrapped in
 * `Reveal`), so it stays the LCP element. Signed out: start free, sign in, and the WhatsApp sign-up
 * block (`whatsappSignup`, absent when WhatsApp login is unavailable); signed in: one button to the
 * dashboard. The waitlist phone capture of `/early` is deliberately not here.
 */
export function HomeHero({
  locale = "ar",
  signedIn,
  whatsappSignup = null,
}: {
  locale?: Locale;
  signedIn: boolean;
  whatsappSignup?: ReactNode;
}) {
  const { hero, scene } = landingFor(locale);
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-x-clip">
      <div className="mx-auto grid max-w-6xl items-center gap-6 px-5 pb-14 pt-6 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pb-24 lg:pt-12">
        <div
          data-hero-visual
          className="relative order-first mx-auto grid w-full max-w-md place-items-center lg:order-last lg:max-w-none"
        >
          <HaloBackdrop />
          <div className="relative z-10 py-2 lg:py-6">
            <WasfaCharacter className="max-sm:w-44!" label={scene.agentName} />
          </div>
        </div>

        <div className="min-w-0">
          <GlassBadge className="px-4 py-1.5 text-[13px] font-semibold leading-snug text-primary sm:text-sm">
            {hero.pill}
          </GlassBadge>
          <h1
            id="hero-title"
            className="mt-5 text-[clamp(2.2rem,1.2rem+4.2vw,4rem)] font-bold leading-[1.3] text-text"
          >
            <span className="block">{hero.titleLines[0]}</span>
            <span className="block text-primary">{hero.titleLines[1]}</span>
          </h1>
          <Reveal delay={80}>
            <p className="mt-5 max-w-xl text-lg leading-[1.85] text-text-muted sm:text-xl">
              {hero.lead}
            </p>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {signedIn ? (
                <Link
                  href="/dashboard"
                  className={buttonStyles({
                    size: "lg",
                    className: "w-full shadow-raised sm:w-auto",
                  })}
                >
                  {hero.dashboardCta}
                  <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/register"
                    className={buttonStyles({
                      size: "lg",
                      className: "w-full shadow-raised sm:w-auto",
                    })}
                  >
                    {hero.primaryCta}
                    <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
                  </Link>
                  <Link
                    href="/login"
                    className={buttonStyles({
                      size: "lg",
                      variant: "secondary",
                      className: "w-full sm:w-auto",
                    })}
                  >
                    {hero.signIn}
                  </Link>
                </>
              )}
            </div>
          </Reveal>
          {signedIn || !whatsappSignup ? null : (
            <Reveal delay={200} className="mt-5 max-w-md">
              {whatsappSignup}
            </Reveal>
          )}
          <Reveal delay={240}>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold text-text/80">
              {hero.chips.map((chip) => (
                <li key={chip} className="inline-flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-primary text-on-primary">
                    <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
                  </span>
                  {chip}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

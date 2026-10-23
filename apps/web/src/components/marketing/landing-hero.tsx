import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight, HeartHandshake } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";

import { IsoScene } from "./iso-scene";

import type { Locale } from "../../lib/locale";

/**
 * Flagship section: liquid-glass trust pill, the two-line Display headline, value proposition, the
 * two calls to action and the scan illustration. On a phone the order is the DOM order: pill,
 * headline, lead, full-width actions, reassurance, then the illustration (BRAND-AND-HOMEPAGE §3.1).
 * The H1 is plain server-rendered text, never animated, so it stays the LCP element.
 */
export function LandingHero({ locale = "ar" }: { locale?: Locale }) {
  const { hero } = landingFor(locale);
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <Container className="relative grid items-center gap-8 pt-10 pb-12 sm:pt-16 lg:grid-cols-[1.4fr_1fr] lg:gap-8 lg:pb-20">
        <div className="min-w-0">
          <div className="hero-pill-wrap">
            <span aria-hidden="true" className="hero-pill-blob" />
            <p className="hero-pill text-base font-semibold text-text">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-b from-accent to-primary text-on-primary shadow-card ring-1 ring-white/70">
                <HeartHandshake aria-hidden="true" className="size-4" />
              </span>
              {hero.pill}
            </p>
          </div>
          <h1 id="hero-title" className="hero-title mt-6 font-bold text-text">
            <span className="block">{hero.titleLines[0]}</span>
            <span className="mt-[0.12em] block text-primary">{hero.titleLines[1]}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-text-muted">{hero.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
            <a
              href="#how-it-works"
              className={buttonStyles({
                size: "lg",
                variant: "secondary",
                className: "w-full sm:w-auto",
              })}
            >
              {hero.secondaryCta}
            </a>
          </div>
          <p className="mt-4 text-sm text-text-muted">{hero.reassurance}</p>
          <p className="mt-1 text-base text-text-muted">
            {hero.haveAccount}{" "}
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center rounded-sm font-bold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("marketing.nav.signIn", undefined, locale)}
            </Link>
          </p>
        </div>
        <div className="min-w-0 xl:-me-24">
          <IsoScene locale={locale} />
        </div>
      </Container>
    </section>
  );
}

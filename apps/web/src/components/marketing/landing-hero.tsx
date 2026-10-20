import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight, HeartHandshake } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";

import { IsoScene } from "./iso-scene";

import type { Locale } from "../../lib/locale";

/**
 * Flagship section: trust pill, the two-line Display headline, value proposition, the two calls to
 * action and the isometric scan scene (the faint Islamic lattice behind it is the layout's).
 */
export function LandingHero({ locale = "ar" }: { locale?: Locale }) {
  const { hero, visual } = landingFor(locale);
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <Container className="relative grid items-center gap-8 pt-10 pb-12 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-20">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold text-text shadow-card">
            <HeartHandshake aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {hero.pill}
          </p>
          <h1 id="hero-title" className="mt-6 text-3xl font-bold text-text sm:text-5xl xl:text-6xl">
            <span className="block">{hero.titleLines[0]}</span>
            <span className="block text-primary">{hero.titleLines[1]}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-text-muted">{hero.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/register"
              className={buttonStyles({ size: "lg", className: "shadow-raised" })}
            >
              {hero.primaryCta}
              <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            </Link>
            <a href="#how-it-works" className={buttonStyles({ size: "lg", variant: "secondary" })}>
              {hero.secondaryCta}
            </a>
          </div>
          <p className="mt-4 text-sm text-text-muted">{hero.reassurance}</p>
          <p className="mt-1 text-base text-text-muted">
            {hero.haveAccount}{" "}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-sm font-bold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("marketing.nav.signIn", undefined, locale)}
            </Link>
          </p>
        </div>
        <div className="lg:-me-16 xl:-me-24">
          <IsoScene locale={locale} />
          <p className="mt-2 text-center text-sm text-text-muted">{visual.sampleBadge}</p>
        </div>
      </Container>
    </section>
  );
}

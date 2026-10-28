import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight, Check, HeartHandshake } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";

import { WhatsAppGlyph } from "./chat-parts";
import { HeroScene } from "./hero-scene";

import type { Locale } from "../../lib/locale";

/**
 * Flagship section: trust pill, the two-line Display headline, value proposition, the two calls to
 * action (start free, chat on WhatsApp), reassurance chips and the chat illustration. The WhatsApp
 * button exists only when the admin set a number (`whatsappHref`). On a phone the order is the DOM
 * order. The H1 is plain server-rendered text, never animated, so it stays the LCP element.
 */
export function LandingHero({
  locale = "ar",
  whatsappHref = null,
}: {
  locale?: Locale;
  /** `wa.me` link with the prefilled greeting, or null when no WhatsApp number is configured. */
  whatsappHref?: string | null;
}) {
  const { hero } = landingFor(locale);
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <div aria-hidden="true" className="dot-grid absolute inset-x-0 top-0 h-136" />
      <Container className="relative grid items-center gap-10 pt-10 pb-14 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pb-24">
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
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                data-wa-cta="hero"
                className={buttonStyles({
                  size: "lg",
                  variant: "secondary",
                  className: "w-full border-wa-deep/30 text-wa-deep hover:bg-wa-green/10 sm:w-auto",
                })}
              >
                <span className="grid size-7 place-items-center rounded-full bg-wa-green text-wa-deep">
                  <WhatsAppGlyph className="size-4.5" />
                </span>
                {hero.whatsappCta}
              </a>
            ) : null}
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-text-muted">
            {hero.chips.map((chip) => (
              <li key={chip} className="inline-flex items-center gap-1.5">
                <Check aria-hidden="true" className="size-4 text-success" />
                {chip}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base text-text-muted">
            {hero.haveAccount}{" "}
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center rounded-sm font-bold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("marketing.nav.signIn", undefined, locale)}
            </Link>
          </p>
        </div>
        <div className="min-w-0">
          <HeroScene locale={locale} />
        </div>
      </Container>
    </section>
  );
}

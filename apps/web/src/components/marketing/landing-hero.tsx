import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { landing } from "../../content/landing";

import { HeroVisual } from "./hero-visual";

const { hero, visual } = landing;

/** Flagship section: Display headline, value proposition, the two calls to action and the product visual. */
export function LandingHero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-x-clip">
      <Container className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-2 lg:gap-14">
        <div>
          <p className="inline-flex rounded-full bg-accent-soft px-4 py-1 font-heading text-sm font-semibold text-primary">
            {hero.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="mt-5 font-heading text-4xl font-bold text-primary sm:text-5xl"
          >
            {hero.title}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-text-muted">{hero.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className={buttonStyles({ size: "lg" })}>
              {hero.primaryCta}
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
              className="inline-flex min-h-11 items-center rounded-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("marketing.nav.signIn")}
            </Link>
          </p>
        </div>
        <div>
          <HeroVisual />
          <p className="text-center text-sm text-text-muted">{visual.sampleBadge}</p>
        </div>
      </Container>
    </section>
  );
}

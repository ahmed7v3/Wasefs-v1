import { Container } from "@wasfa/ui";
import { Languages, Lock, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";

import { type TrustIcon } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";

import { SectionHeading } from "./section-heading";

import type { Locale } from "../../lib/locale";

const ICONS = {
  shield: ShieldCheck,
  lock: Lock,
  stethoscope: Stethoscope,
  languages: Languages,
} as const satisfies Record<TrustIcon, unknown>;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Privacy and trust: the dark navy band of the page (light text, white lattice). */
export function TrustSection({ locale = "ar" }: { locale?: Locale }) {
  const { trust } = landingFor(locale);
  return (
    <section
      aria-labelledby="trust-title"
      className="relative overflow-hidden bg-primary py-16 text-on-primary sm:py-24"
    >
      <div aria-hidden="true" className="lattice-light absolute inset-0" />
      <Container className="relative">
        <SectionHeading id="trust-title" tone="inverse" title={trust.title} lead={trust.lead} />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {trust.items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li
                key={item.title}
                className="rounded-3xl border border-white/15 bg-white/8 p-6 backdrop-blur-sm"
              >
                <span className="grid size-12 place-items-center rounded-xl bg-white/15 text-white">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <h3 className="mt-4 text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-base text-white/85">{item.body}</p>
              </li>
            );
          })}
        </ul>
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
          <Link
            href="/privacy"
            className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-5 text-base font-bold text-primary transition-colors duration-150 hover:bg-primary-soft ${focus}`}
          >
            {trust.privacyLink}
          </Link>
          <Link
            href="/disclaimer"
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-white/50 px-5 text-base font-bold text-white transition-colors duration-150 hover:bg-white/10 ${focus}`}
          >
            {trust.disclaimerLink}
          </Link>
        </div>
      </Container>
    </section>
  );
}

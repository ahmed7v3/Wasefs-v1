import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { localizedPath, type Locale } from "../../lib/locale";

import { Mascot } from "./mascot";

/** The whole family, from the edges in: the outer two only appear from `sm` up. */
const GROUP = [
  {
    name: "hexagon",
    className: "hidden size-16 sm:block sm:size-20",
    delay: "[animation-delay:0.6s]",
  },
  { name: "clover", className: "size-10 sm:size-20", delay: "[animation-delay:1.4s]" },
  { name: "capsule", className: "size-12 sm:size-24", delay: "[animation-delay:0.2s]" },
  { name: "star", className: "size-20 sm:size-36", delay: "[animation-delay:1s]" },
  { name: "tablet", className: "size-12 sm:size-24", delay: "[animation-delay:1.8s]" },
  { name: "blob", className: "size-10 sm:size-20", delay: "[animation-delay:0.4s]" },
  {
    name: "droplet",
    className: "hidden size-16 sm:block sm:size-20",
    delay: "[animation-delay:1.2s]",
  },
] as const;

export function FinalCta({ locale = "ar" }: { locale?: Locale }) {
  const { cta } = landingFor(locale);
  return (
    <section aria-labelledby="cta-title" className="pt-4 pb-16 sm:pb-24">
      <Container>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-6 pt-10 pb-12 text-center shadow-raised sm:px-12 sm:pt-14 sm:pb-16">
          <div aria-hidden="true" className="lattice absolute inset-0" />
          <div className="relative">
            <div aria-hidden="true" className="flex items-end justify-center gap-1 sm:gap-3">
              {GROUP.map((mascot) => (
                <span key={mascot.name} className={`float-slow ${mascot.delay}`}>
                  <Mascot name={mascot.name} className={mascot.className} />
                </span>
              ))}
            </div>
            <h2 id="cta-title" className="mt-8 text-2xl font-bold text-text sm:text-4xl">
              {cta.title}
            </h2>
            <p className="mx-auto mt-3 max-w-reading text-lg text-text-muted">{cta.body}</p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className={buttonStyles({ size: "lg", className: "shadow-raised" })}
              >
                {cta.primary}
                <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              </Link>
              <Link
                href={localizedPath("/contact", locale)}
                className={buttonStyles({ size: "lg", variant: "secondary" })}
              >
                {cta.secondary}
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

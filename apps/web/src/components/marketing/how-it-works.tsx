import { Container } from "@wasfa/ui";
import { ClipboardCheck, ScanText, Upload } from "lucide-react";

import { landingFor } from "../../content/landing-locale";

import { WhatsAppGlyph } from "./chat-parts";
import { SectionHeading } from "./section-heading";

import type { Locale } from "../../lib/locale";

/** One icon per step, in the order of `how.steps` (the copy has no icon of its own). */
const STEP_ICONS = [Upload, ScanText, ClipboardCheck] as const;

/** Three numbered steps joined by a dashed line (horizontal from `md`, vertical on a phone). */
export function HowItWorks({
  locale = "ar",
  whatsappHref = null,
}: {
  locale?: Locale;
  whatsappHref?: string | null;
}) {
  const { how } = landingFor(locale);
  return (
    <section id={how.id} aria-labelledby="how-title" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="how-title" eyebrow={how.eyebrow} title={how.title} lead={how.lead} />
        <ol className="relative mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
          <svg
            viewBox="0 0 2 100"
            preserveAspectRatio="none"
            className="motion-draw absolute inset-y-8 start-[27px] w-0.5 md:hidden"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M1 0V100"
              className="stroke-primary/30"
              strokeWidth="2"
              strokeDasharray="4 5"
              strokeDashoffset="0"
              vectorEffect="non-scaling-stroke"
            />
            <path d="M1 0V100" pathLength="1" className="stroke-primary" strokeWidth="2" />
          </svg>
          <svg
            viewBox="0 0 100 2"
            preserveAspectRatio="none"
            className="motion-draw absolute inset-x-[16.6%] top-[27px] hidden h-0.5 md:block rtl:-scale-x-100"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M0 1H100"
              className="stroke-primary/30"
              strokeWidth="2"
              strokeDasharray="4 5"
              strokeDashoffset="0"
              vectorEffect="non-scaling-stroke"
            />
            <path d="M0 1H100" pathLength="1" className="stroke-primary" strokeWidth="2" />
          </svg>
          {how.steps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? Upload;
            return (
              <li key={step.title} className="relative flex gap-4 md:flex-col md:items-center">
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-on-primary tabular-nums shadow-card ring-8 ring-bg-warm">
                  {index + 1}
                </span>
                <div className="flex-1 rounded-3xl border border-border bg-surface p-5 shadow-card md:w-full md:text-center">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary md:mx-auto">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <h3 className="mt-3 text-xl font-bold text-text">{step.title}</h3>
                  <p className="mt-2 text-base text-text-muted">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mx-auto mt-10 flex max-w-fit flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-wa-green/40 bg-wa-green/10 py-2 ps-5 pe-3 text-base font-bold text-wa-deep">
          <WhatsAppGlyph className="size-5" />
          {how.whatsappNote}
          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-wa-cta="how"
              className="inline-flex min-h-11 items-center rounded-full bg-wa-deep px-4 text-white focus-visible:outline-none focus-visible:shadow-focus"
            >
              {how.whatsappLink}
            </a>
          ) : null}
        </p>
      </Container>
    </section>
  );
}

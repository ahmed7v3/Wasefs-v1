import { Container } from "@wasfa/ui";
import { ClipboardCheck, ScanText, Upload } from "lucide-react";

import { landing } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { how } = landing;

/** One icon per step, in the order of `how.steps` (the copy has no icon of its own). */
const STEP_ICONS = [Upload, ScanText, ClipboardCheck] as const;

/** Three numbered steps joined by a dashed line (horizontal from `md`, vertical on a phone). */
export function HowItWorks() {
  return (
    <section id={how.id} aria-labelledby="how-title" className="py-16 sm:py-24">
      <Container>
        <SectionHeading id="how-title" eyebrow={how.eyebrow} title={how.title} lead={how.lead} />
        <ol className="relative mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
          <span
            aria-hidden="true"
            className="absolute inset-y-8 start-7 border-s-2 border-dashed border-primary/30 md:hidden"
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-[16.6%] top-7 hidden border-t-2 border-dashed border-primary/30 md:block"
          />
          {how.steps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? Upload;
            return (
              <li key={step.title} className="relative flex gap-4 md:flex-col md:items-center">
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-on-primary tabular-nums shadow-card ring-8 ring-bg-warm">
                  {index + 1}
                </span>
                <div className="flex-1 rounded-2xl border border-border bg-surface p-5 shadow-card md:w-full md:text-center">
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
      </Container>
    </section>
  );
}

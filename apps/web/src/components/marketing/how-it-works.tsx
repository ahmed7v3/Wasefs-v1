import { Card, Container } from "@wasfa/ui";
import { ClipboardCheck, ScanText, Upload } from "lucide-react";

import { landing } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { how } = landing;

/** One icon per step, in the order of `how.steps` (the copy has no icon of its own). */
const STEP_ICONS = [Upload, ScanText, ClipboardCheck] as const;

export function HowItWorks() {
  return (
    <section id={how.id} aria-labelledby="how-title" className="scroll-mt-4 py-12 sm:py-20">
      <Container>
        <SectionHeading id="how-title" title={how.title} lead={how.lead} />
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {how.steps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? Upload;
            return (
              <li key={step.title}>
                <Card className="h-full">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-lg bg-primary-soft text-primary">
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                    <span className="font-heading text-lg font-semibold text-text-muted tabular-nums">
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 font-heading text-xl font-semibold text-text">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-base text-text-muted">{step.body}</p>
                </Card>
              </li>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}

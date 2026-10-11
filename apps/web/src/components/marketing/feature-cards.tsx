import { Card, ComingSoonBadge, Container } from "@wasfa/ui";
import { Building2, ScanText, Sparkles } from "lucide-react";

import { landing, type FeatureIcon } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { features } = landing;

const ICONS = { scan: ScanText, sparkles: Sparkles, building: Building2 } as const satisfies Record<
  FeatureIcon,
  unknown
>;

export function FeatureCards() {
  return (
    <section
      id={features.id}
      aria-labelledby="features-title"
      className="scroll-mt-4 py-12 sm:py-20"
    >
      <Container>
        <SectionHeading id="features-title" title={features.title} lead={features.lead} />
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {features.items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.title}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-12 place-items-center rounded-lg bg-primary-soft text-primary">
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                    {item.soon ? <ComingSoonBadge /> : null}
                  </div>
                  <h3 className="mt-5 font-heading text-xl font-semibold text-text">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-base text-text-muted">{item.body}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

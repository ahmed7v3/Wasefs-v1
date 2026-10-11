import { ComingSoonBadge, Container } from "@wasfa/ui";
import { Building2, Check, Pill, Stethoscope, UserRound } from "lucide-react";

import { landing, type AudienceIcon, type Tone } from "../../content/landing";

import { SectionHeading } from "./section-heading";

const { audiences } = landing;

const ICONS = {
  patient: UserRound,
  pharmacist: Pill,
  doctor: Stethoscope,
  organization: Building2,
} as const satisfies Record<AudienceIcon, unknown>;

/** Accent bar on top of the card and the tint of the icon tile; full class names for Tailwind. */
const ACCENT: Record<Tone, { bar: string; wash: string }> = {
  navy: { bar: "border-t-mascot-navy", wash: "bg-mascot-navy/10" },
  coral: { bar: "border-t-mascot-coral", wash: "bg-mascot-coral/10" },
  teal: { bar: "border-t-mascot-teal", wash: "bg-mascot-teal/10" },
  amber: { bar: "border-t-mascot-amber", wash: "bg-mascot-amber/12" },
  olive: { bar: "border-t-mascot-olive", wash: "bg-mascot-olive/10" },
  indigo: { bar: "border-t-mascot-indigo", wash: "bg-mascot-indigo/10" },
};

/** Who it is for: patients, pharmacists, doctors, and pharmacies and clinics (organizations). */
export function Audiences() {
  return (
    <section
      id={audiences.id}
      aria-labelledby="audiences-title"
      className="border-t border-border/70 py-16 sm:py-24"
    >
      <Container>
        <SectionHeading
          id="audiences-title"
          eyebrow={audiences.eyebrow}
          title={audiences.title}
          lead={audiences.lead}
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audiences.items.map((item) => {
            const Icon = ICONS[item.icon];
            const accent = ACCENT[item.tone];
            return (
              <li key={item.title}>
                <article
                  className={`flex h-full flex-col rounded-2xl border border-border border-t-4 bg-surface p-6 shadow-card transition-[transform,box-shadow] duration-200 ease-standard hover:-translate-y-1 hover:shadow-raised ${accent.bar}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`grid size-12 place-items-center rounded-xl text-text ${accent.wash}`}
                    >
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                    {item.soon ? <ComingSoonBadge /> : null}
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-text">{item.title}</h3>
                  <p className="mt-2 text-base text-text-muted">{item.body}</p>
                  <ul className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4">
                    {item.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-base text-text">
                        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

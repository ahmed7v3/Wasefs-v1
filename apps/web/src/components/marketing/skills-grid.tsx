import { t } from "@wasfa/shared/i18n";
import { Badge, Container } from "@wasfa/ui";

import { type Tone } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";

import { Mascot } from "./mascot";
import { SectionHeading } from "./section-heading";

import type { Locale } from "../../lib/locale";

/** Tinted disc behind each mascot; full class names so Tailwind can see them. */
const WASH: Record<Tone, string> = {
  navy: "bg-mascot-navy/10",
  coral: "bg-mascot-coral/10",
  teal: "bg-mascot-teal/10",
  amber: "bg-mascot-amber/12",
  olive: "bg-mascot-olive/10",
  indigo: "bg-mascot-indigo/10",
};

/** "Wasfa skills": six cards, each with its own mascot, like the team of agents in the reference. */
export function SkillsGrid({ locale = "ar" }: { locale?: Locale }) {
  const { skills } = landingFor(locale);
  return (
    <section
      id={skills.id}
      aria-labelledby="skills-title"
      className="border-t border-border/70 py-16 sm:py-24"
    >
      <Container>
        <SectionHeading
          id="skills-title"
          eyebrow={skills.eyebrow}
          title={skills.title}
          lead={skills.lead}
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.items.map((item) => (
            <li key={item.title} className="motion-settle">
              <article className="group flex h-full items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5 transition-[transform,box-shadow] duration-200 ease-standard hover:-translate-y-1 hover:shadow-raised sm:p-6">
                <div className="min-w-0">
                  {item.soon ? (
                    <Badge tone="info" className="mb-2">
                      {t("ui.comingSoon", undefined, locale)}
                    </Badge>
                  ) : null}
                  <h3 className="text-xl font-bold text-text">{item.title}</h3>
                  <p className="mt-1.5 text-base text-text-muted">{item.body}</p>
                </div>
                <span
                  className={`grid size-20 shrink-0 place-items-center rounded-full ${WASH[item.tone]}`}
                >
                  <Mascot
                    name={item.mascot}
                    className="size-14 transition-transform duration-200 ease-standard group-hover:-rotate-6 group-hover:scale-110"
                  />
                </span>
              </article>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

import { t } from "@wasfa/shared/i18n";
import { Badge } from "@wasfa/ui";
import { BookOpenText, Droplets, Layers, ScanText, Store, TestTubeDiagonal } from "lucide-react";

import { type MascotName } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";
import { Reveal } from "../visual/Reveal";

import { HOME_CARD, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";

/** One icon per skill; the copy keeps its `mascot` key as the stable identity of each skill. */
const SKILL_ICONS = {
  capsule: ScanText,
  hexagon: Layers,
  droplet: Droplets,
  tablet: BookOpenText,
  blob: Store,
  clover: TestTubeDiagonal,
  star: ScanText,
} as const satisfies Record<MascotName, unknown>;

/** The skills of the assistant, one card each. */
export function SkillsSection({ locale = "ar" }: { locale?: Locale }) {
  const { skills } = landingFor(locale);
  return (
    <HomeSection id={skills.id} labelledBy="skills-title" className="border-t border-text/8">
      <HomeHeading
        id="skills-title"
        eyebrow={skills.eyebrow}
        title={skills.title}
        lead={skills.lead}
      />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {skills.items.map((item, index) => {
          const Icon = SKILL_ICONS[item.mascot];
          return (
            <Reveal key={item.title} as="li" delay={(index % 3) * 70}>
              <article
                className={`${HOME_CARD} h-full p-6 transition-transform duration-200 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:transform-none`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
                    <Icon className="size-6" aria-hidden="true" />
                  </span>
                  {item.soon ? (
                    <Badge tone="info">{t("ui.comingSoon", undefined, locale)}</Badge>
                  ) : null}
                </div>
                <h3 className="mt-4 text-xl font-bold leading-snug text-text">{item.title}</h3>
                <p className="mt-2 text-base leading-[1.8] text-text-muted">{item.body}</p>
              </article>
            </Reveal>
          );
        })}
      </ul>
    </HomeSection>
  );
}

import { t } from "@wasfa/shared/i18n";
import { Badge } from "@wasfa/ui";
import { Building2, Check, Pill, Stethoscope, UserRound } from "lucide-react";

import { type AudienceIcon } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";
import { Reveal } from "../visual/Reveal";

import { HOME_CARD, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";

const ICONS = {
  patient: UserRound,
  pharmacist: Pill,
  doctor: Stethoscope,
  organization: Building2,
} as const satisfies Record<AudienceIcon, unknown>;

/** Who it is for: patients, pharmacists, doctors, and pharmacies and clinics (organizations). */
export function AudiencesSection({ locale = "ar" }: { locale?: Locale }) {
  const { audiences } = landingFor(locale);
  return (
    <HomeSection id={audiences.id} labelledBy="audiences-title" className="border-t border-text/8">
      <HomeHeading
        id="audiences-title"
        eyebrow={audiences.eyebrow}
        title={audiences.title}
        lead={audiences.lead}
      />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {audiences.items.map((item, index) => {
          const Icon = ICONS[item.icon];
          return (
            <Reveal key={item.title} as="li" delay={(index % 4) * 70}>
              <article className={`${HOME_CARD} flex h-full flex-col p-6`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  {item.soon ? (
                    <Badge tone="info">{t("ui.comingSoon", undefined, locale)}</Badge>
                  ) : null}
                </div>
                <h3 className="mt-4 text-xl font-bold text-text">{item.title}</h3>
                <p className="mt-2 text-base leading-[1.8] text-text-muted">{item.body}</p>
                <ul className="mt-4 flex flex-col gap-2 border-t border-text/8 pt-4">
                  {item.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-base text-text">
                      <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          );
        })}
      </ul>
    </HomeSection>
  );
}

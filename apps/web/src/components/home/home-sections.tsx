import { AppsSection } from "./apps-section";
import { AudiencesSection } from "./audiences-section";
import { FaqSection } from "./faq-section";
import { FinalCta } from "./final-cta";
import { HowSection } from "./how-section";
import { PrecisionSection } from "./precision-section";
import { SkillsSection } from "./skills-section";
import { TrustSection } from "./trust-section";
import { WhatsAppSection } from "./whatsapp-section";

import type { Locale } from "../../lib/locale";
import type { LandingSectionKey, PublicSettings } from "@wasfa/shared/settings";
import type { ReactElement } from "react";

export interface HomeSectionContext {
  locale: Locale;
  settings: PublicSettings;
  /** `wa.me` link with the prefilled greeting, or null when no WhatsApp number is configured. */
  whatsappHref: string | null;
  signedIn: boolean;
}

/** The section behind an admin-ordered key (`landing.sections`); the pages render them as siblings. */
export function renderHomeSection(
  key: LandingSectionKey,
  { locale, settings, whatsappHref, signedIn }: HomeSectionContext,
): ReactElement {
  switch (key) {
    case "whatsapp":
      return <WhatsAppSection locale={locale} whatsappHref={whatsappHref} />;
    case "skills":
      return <SkillsSection locale={locale} />;
    case "precision":
      return (
        <PrecisionSection
          locale={locale}
          proof={settings.landing.proof}
          westernDigits={settings.locale.westernDigits}
        />
      );
    case "how":
      return <HowSection locale={locale} whatsappHref={whatsappHref} />;
    case "audiences":
      return <AudiencesSection locale={locale} />;
    case "trust":
      return <TrustSection locale={locale} />;
    case "faq":
      return <FaqSection locale={locale} />;
    case "apps":
      return <AppsSection settings={settings} locale={locale} />;
    case "final":
      return <FinalCta locale={locale} signedIn={signedIn} whatsappHref={whatsappHref} />;
  }
}

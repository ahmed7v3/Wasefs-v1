import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";

import { AppsBand } from "../../../components/marketing/apps-band";
import { Audiences } from "../../../components/marketing/audiences";
import { FaqSection } from "../../../components/marketing/faq-section";
import { FinalCta } from "../../../components/marketing/final-cta";
import { HowItWorks } from "../../../components/marketing/how-it-works";
import { JsonLd } from "../../../components/marketing/json-ld";
import { LandingHero } from "../../../components/marketing/landing-hero";
import { MascotSprite } from "../../../components/marketing/mascot";
import { PrecisionWalkthrough } from "../../../components/marketing/precision-walkthrough";
import { SkillsGrid } from "../../../components/marketing/skills-grid";
import { TrustSection } from "../../../components/marketing/trust-section";
import { Notice } from "../../../components/notice";
import { landingEn } from "../../../content/landing.en";
import { publicEnv } from "../../../lib/env";
import { getNonce } from "../../../lib/nonce";
import { getPublicSettings } from "../../../lib/public-settings";
import { pageMetadata } from "../../../lib/seo";
import {
  faqJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../../../lib/structured-data";

import type { Metadata } from "next";

const LOCALE = "en";
const DESCRIPTION = t("meta.description", undefined, LOCALE);

export const metadata: Metadata = pageMetadata("home", { description: DESCRIPTION }, LOCALE);

/** The English home page: the same sections as the Arabic one, with English copy. */
export default async function EnglishHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ notice }, settings, nonce] = await Promise.all([
    searchParams,
    getPublicSettings(),
    getNonce(),
  ]);
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL;

  return (
    <>
      <JsonLd data={organizationJsonLd(settings, siteUrl)} nonce={nonce} />
      <JsonLd data={webSiteJsonLd(settings, siteUrl)} nonce={nonce} />
      <JsonLd data={softwareApplicationJsonLd(settings, siteUrl, DESCRIPTION)} nonce={nonce} />
      <JsonLd data={faqJsonLd(landingEn.faq.items)} nonce={nonce} />

      {notice === "account_deleted" ? (
        <Container className="pt-4">
          <Notice>{landingEn.notices.accountDeleted}</Notice>
        </Container>
      ) : null}
      <MascotSprite />
      <LandingHero locale={LOCALE} />
      <SkillsGrid locale={LOCALE} />
      <PrecisionWalkthrough
        locale={LOCALE}
        proof={settings.landing.proof}
        westernDigits={settings.locale.westernDigits}
      />
      <HowItWorks locale={LOCALE} />
      <Audiences locale={LOCALE} />
      <TrustSection locale={LOCALE} />
      <FaqSection locale={LOCALE} />
      <AppsBand settings={settings} locale={LOCALE} />
      <FinalCta locale={LOCALE} />
    </>
  );
}

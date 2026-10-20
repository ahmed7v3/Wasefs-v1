import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";

import { AppsBand } from "../../components/marketing/apps-band";
import { Audiences } from "../../components/marketing/audiences";
import { FaqSection } from "../../components/marketing/faq-section";
import { FinalCta } from "../../components/marketing/final-cta";
import { HowItWorks } from "../../components/marketing/how-it-works";
import { JsonLd } from "../../components/marketing/json-ld";
import { LandingHero } from "../../components/marketing/landing-hero";
import { MascotSprite } from "../../components/marketing/mascot";
import { PrecisionDemo } from "../../components/marketing/precision-demo";
import { SkillsGrid } from "../../components/marketing/skills-grid";
import { TrustSection } from "../../components/marketing/trust-section";
import { Notice } from "../../components/notice";
import { landing } from "../../content/landing";
import { publicEnv } from "../../lib/env";
import { getNonce } from "../../lib/nonce";
import { getPublicSettings } from "../../lib/public-settings";
import { pageMetadata } from "../../lib/seo";
import {
  faqJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../../lib/structured-data";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("home", { description: t("meta.description") });

/** Where the account-deletion flow lands (`DELETED_NOTICE_PATH`). */
const DELETED_NOTICE = "account_deleted";

export default async function HomePage({
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
      <JsonLd
        data={softwareApplicationJsonLd(settings, siteUrl, t("meta.description"))}
        nonce={nonce}
      />
      <JsonLd data={faqJsonLd(landing.faq.items)} nonce={nonce} />

      {notice === DELETED_NOTICE ? (
        <Container className="pt-4">
          <Notice>{landing.notices.accountDeleted}</Notice>
        </Container>
      ) : null}
      <MascotSprite />
      <LandingHero />
      <SkillsGrid />
      <PrecisionDemo />
      <HowItWorks />
      <Audiences />
      <TrustSection />
      <FaqSection />
      <AppsBand settings={settings} />
      <FinalCta />
    </>
  );
}

import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import { Fragment } from "react";

import { HomeHero } from "../../../components/home/home-hero";
import { renderHomeSection, type HomeSectionContext } from "../../../components/home/home-sections";
import { JsonLd } from "../../../components/marketing/json-ld";
import { Notice } from "../../../components/notice";
import { landingEn } from "../../../content/landing.en";
import { whatsappUrl } from "../../../lib/contact-links";
import { publicEnv } from "../../../lib/env";
import { homePlanOffers } from "../../../lib/home-plans";
import { visibleLandingSections } from "../../../lib/landing-sections";
import { getNonce } from "../../../lib/nonce";
import { getPublicSettings } from "../../../lib/public-settings";
import { pageMetadata } from "../../../lib/seo";
import { getMe } from "../../../lib/session";
import { homeStructuredData } from "../../../lib/structured-data";

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
  const [{ notice }, settings, nonce, me, plans] = await Promise.all([
    searchParams,
    getPublicSettings(),
    getNonce(),
    getMe().catch(() => null),
    homePlanOffers(LOCALE),
  ]);
  const signedIn = me !== null;
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL;
  const whatsappHref = whatsappUrl(settings.contact.whatsapp, landingEn.hero.whatsappGreeting);

  const context: HomeSectionContext = { locale: LOCALE, settings, whatsappHref, signedIn };
  const sections = visibleLandingSections(settings.landing.sections);

  return (
    <>
      {homeStructuredData({
        settings,
        siteUrl,
        description: DESCRIPTION,
        faqs: landingEn.faq.items,
        plans,
      }).map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}

      {notice === "account_deleted" ? (
        <Container className="pt-4">
          <Notice>{landingEn.notices.accountDeleted}</Notice>
        </Container>
      ) : null}
      <HomeHero locale={LOCALE} signedIn={signedIn} />
      {/* Sections are siblings on purpose: ad slots are inserted between them. */}
      {sections.map((key) => (
        <Fragment key={key}>{renderHomeSection(key, context)}</Fragment>
      ))}
    </>
  );
}

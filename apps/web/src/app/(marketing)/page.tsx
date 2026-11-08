import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import { Fragment } from "react";

import { AdSlot } from "../../components/ads/ad-slot";
import { WhatsAppLoginLazy } from "../../components/auth/whatsapp-login-lazy";
import { HomeHero } from "../../components/home/home-hero";
import { renderHomeSection, type HomeSectionContext } from "../../components/home/home-sections";
import { JsonLd } from "../../components/marketing/json-ld";
import { Notice } from "../../components/notice";
import { landing } from "../../content/landing";
import { whatsappUrl } from "../../lib/contact-links";
import { publicEnv } from "../../lib/env";
import { homePlanOffers } from "../../lib/home-plans";
import { visibleLandingSections } from "../../lib/landing-sections";
import { getNonce } from "../../lib/nonce";
import { getPublicSettings } from "../../lib/public-settings";
import { pageMetadata } from "../../lib/seo";
import { getMe } from "../../lib/session";
import { homeStructuredData } from "../../lib/structured-data";
import { loadWhatsAppAvailable } from "../../lib/whatsapp-availability";

import { adClass } from "./ad-class";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("home", { description: t("meta.description") });

/** Where the account-deletion flow lands (`DELETED_NOTICE_PATH`). */
const DELETED_NOTICE = "account_deleted";

/** A slot renders nothing without a creative, so these margins only exist when an ad does. */
const HOME_AD_CLASS = "my-6 px-4";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ notice }, settings, nonce, me, plans, whatsappAvailable] = await Promise.all([
    searchParams,
    getPublicSettings(),
    getNonce(),
    getMe().catch(() => null),
    homePlanOffers("ar"),
    loadWhatsAppAvailable(),
  ]);
  const signedIn = me !== null;
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL;
  const whatsappHref = whatsappUrl(settings.contact.whatsapp, landing.hero.whatsappGreeting);

  const context: HomeSectionContext = { locale: "ar", settings, whatsappHref, signedIn };
  const sections = visibleLandingSections(settings.landing.sections);

  return (
    <>
      {homeStructuredData({
        settings,
        siteUrl,
        description: t("meta.description"),
        faqs: landing.faq.items,
        plans,
      }).map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}

      {notice === DELETED_NOTICE ? (
        <Container className="pt-4">
          <Notice>{landing.notices.accountDeleted}</Notice>
        </Container>
      ) : null}
      <HomeHero
        signedIn={signedIn}
        whatsappSignup={
          whatsappAvailable && !signedIn ? (
            <WhatsAppLoginLazy available next="/dashboard" nonce={nonce} compact />
          ) : null
        }
      />
      {/* Sections are siblings on purpose: ad slots are inserted between them. */}
      <AdSlot
        placement="home.after_hero"
        pageClass={adClass}
        locale="ar"
        className={HOME_AD_CLASS}
      />
      {sections.map((key) => (
        <Fragment key={key}>
          {key === "faq" ? (
            <AdSlot
              placement="home.before_faq"
              pageClass={adClass}
              locale="ar"
              className={HOME_AD_CLASS}
            />
          ) : null}
          {renderHomeSection(key, context)}
          {key === "how" ? (
            <AdSlot
              placement="home.mid"
              pageClass={adClass}
              locale="ar"
              className={HOME_AD_CLASS}
            />
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

import { Apple, Check, Globe, ShieldCheck } from "lucide-react";

import { landingFor } from "../../content/landing-locale";
import { AppWaitlistFormLazy } from "../marketing/app-waitlist-lazy";
import { PlatformChips } from "../marketing/apps-band";
import { MedCard, PhoneShell, WhatsAppGlyph } from "../marketing/chat-parts";
import { Reveal } from "../visual/Reveal";

import { HOME_CARD, HomeHeading, HomeSection } from "./home-section";

import type { Locale } from "../../lib/locale";
import type { PublicSettings } from "@wasfa/shared/settings";

const WAY_ICONS = { whatsapp: WhatsAppGlyph, web: Globe, native: Apple } as const;

/** The web app in miniature: the result screen of a prescription with two medicines and their schedules. */
function AppPhone({ locale }: { locale: Locale }) {
  const { apps, scene } = landingFor(locale);
  return (
    <div role="img" aria-label={apps.phoneLabel} className="relative mx-auto">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -inset-y-6 rounded-[3rem] bg-[radial-gradient(closest-side,var(--color-accent-soft),transparent)]"
      />
      <PhoneShell className="relative" screenClassName="bg-bg">
        <div aria-hidden="true" className="px-3 pt-8 pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-text">{apps.resultTitle}</span>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
              {apps.resultMeta}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {scene.items.map((item) => (
              <MedCard key={item.name} item={item} />
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1 text-xs text-text-muted">
            <ShieldCheck aria-hidden="true" className="size-3.5 text-success" />
            {apps.resultNote}
          </p>
          <p className="mt-2 text-center text-xs font-bold text-text-muted">{apps.sampleBadge}</p>
        </div>
      </PhoneShell>
    </div>
  );
}

/**
 * "Wasfa in your pocket": the honest picture. WhatsApp and the installable web app work today, the
 * native apps are coming. A phone with the result screen, the three ways, the store chips and (only
 * while the setting allows) the lazy waiting-list form, the one client island of the section.
 */
export function AppsSection({
  settings,
  locale = "ar",
}: {
  settings: PublicSettings;
  locale?: Locale;
}) {
  const { apps } = landingFor(locale);
  const { androidUrl, iosUrl, waitlistEnabled } = settings.landing.apps;
  return (
    <HomeSection labelledBy="apps-title" className="border-t border-text/8">
      <div
        data-apps-band
        className="relative overflow-hidden rounded-[32px] bg-linear-to-br from-white via-white to-primary-soft p-6 shadow-[0_2px_4px_rgb(11_18_32/0.04),0_30px_70px_-30px_rgb(30_58_138/0.35)] ring-1 ring-primary/10 sm:p-10 lg:p-14"
      >
        <div className="grid items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
          <Reveal>
            <AppPhone locale={locale} />
          </Reveal>
          <div className="min-w-0">
            <HomeHeading id="apps-title" title={apps.title} lead={apps.lead} align="start" />
            <ul aria-label={apps.waysLabel} className="mt-6 grid gap-3">
              {apps.ways.map((way) => {
                const Icon = WAY_ICONS[way.key];
                const live = way.key !== "native";
                return (
                  <li key={way.key} className={`${HOME_CARD} flex items-start gap-4 p-4`}>
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                        way.key === "whatsapp"
                          ? "bg-[#25d366]/20 text-[#075e54]"
                          : "bg-primary-soft text-primary"
                      }`}
                    >
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="text-lg font-bold text-text">{way.title}</h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 text-sm font-bold ${
                            live ? "bg-success-soft text-success" : "bg-accent-soft text-primary"
                          }`}
                        >
                          {live ? <Check aria-hidden="true" className="size-3.5" /> : null}
                          {way.status}
                        </span>
                      </div>
                      <p className="mt-1 text-base leading-[1.7] text-text-muted">{way.body}</p>
                      {way.key === "native" ? (
                        <div className="mt-3">
                          <PlatformChips apps={{ androidUrl, iosUrl }} locale={locale} />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {waitlistEnabled ? (
              <div className="mt-8 max-w-md">
                <AppWaitlistFormLazy locale={locale} copy={apps.waitlist} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </HomeSection>
  );
}

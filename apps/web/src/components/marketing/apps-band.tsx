import { Container } from "@wasfa/ui";
import { Apple, Bot, Check, Globe, ShieldCheck } from "lucide-react";

import { landingFor } from "../../content/landing-locale";

import { AppWaitlistFormLazy } from "./app-waitlist-lazy";
import { PhoneShell, MedCard, WhatsAppGlyph } from "./chat-parts";

import type { Locale } from "../../lib/locale";
import type { PublicSettings } from "@wasfa/shared/settings";

type AppsSettings = PublicSettings["landing"]["apps"];

const chipBase =
  "inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm font-semibold text-text";

/**
 * The two platform chips. Neutral "coming soon" chips until a store URL is set; then that chip
 * becomes a plain link with the store name (text and platform icon only: the official badge artwork
 * needs a live listing and the stores' brand rules).
 */
export function PlatformChips({
  apps,
  locale = "ar",
  compact = false,
}: {
  apps: Pick<AppsSettings, "androidUrl" | "iosUrl">;
  locale?: Locale;
  compact?: boolean;
}) {
  const copy = landingFor(locale).apps;
  const size = compact ? "min-h-9" : "min-h-11";
  const platforms = [
    { key: "android", Icon: Bot, name: copy.android, store: copy.googlePlay, url: apps.androidUrl },
    { key: "ios", Icon: Apple, name: copy.ios, store: copy.appStore, url: apps.iosUrl },
  ] as const;
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {platforms.map(({ key, Icon, name, store, url }) => (
        <li key={key}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-platform={key}
              className={`${chipBase} ${size} border-primary text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus`}
            >
              <Icon aria-hidden="true" className="size-4" />
              {store}
            </a>
          ) : (
            <span data-platform={key} className={`${chipBase} ${size}`}>
              <Icon aria-hidden="true" className="size-4 text-text-muted" />
              {name}
              <span className="text-text-muted">· {copy.soon}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

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

const WAY_ICONS = { whatsapp: WhatsAppGlyph, web: Globe, native: Apple } as const;

/**
 * "Wasfa in your pocket": the honest picture. WhatsApp and the installable web app work today, the
 * native apps are coming. A phone with the result screen, the three ways, the store chips and (only
 * while the setting allows) the lazy waiting-list form, the one client island of the band.
 */
export function AppsBand({
  settings,
  locale = "ar",
}: {
  settings: PublicSettings;
  locale?: Locale;
}) {
  const { apps } = landingFor(locale);
  const { androidUrl, iosUrl, waitlistEnabled } = settings.landing.apps;
  return (
    <section
      aria-labelledby="apps-title"
      data-apps-band
      className="border-t border-border/70 py-16 sm:py-24"
    >
      <Container>
        <div className="relative overflow-hidden rounded-[1.75rem] border border-border bg-surface p-6 shadow-raised sm:p-10 lg:p-14">
          <div aria-hidden="true" className="dot-grid absolute inset-x-0 top-0 h-56" />
          <div className="relative grid items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
            <AppPhone locale={locale} />
            <div className="min-w-0">
              <h2 id="apps-title" className="text-2xl font-bold text-text sm:text-4xl">
                {apps.title}
              </h2>
              <p className="mt-3 max-w-reading text-lg text-text-muted">{apps.lead}</p>
              <ul aria-label={apps.waysLabel} className="mt-6 grid gap-3">
                {apps.ways.map((way) => {
                  const Icon = WAY_ICONS[way.key];
                  const live = way.key !== "native";
                  return (
                    <li
                      key={way.key}
                      className="flex items-start gap-4 rounded-2xl border border-border bg-bg-warm p-4"
                    >
                      <span
                        className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                          way.key === "whatsapp"
                            ? "bg-wa-green/20 text-wa-deep"
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
                        <p className="mt-1 text-base text-text-muted">{way.body}</p>
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
      </Container>
    </section>
  );
}

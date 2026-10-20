import { Container } from "@wasfa/ui";
import { Apple, Bot, ShieldCheck } from "lucide-react";

import { landingFor } from "../../content/landing-locale";

import { AppWaitlistForm } from "./app-waitlist-form";

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

/** A phone drawn in CSS around a mini result card (the same sample lines as the hero). Decorative. */
function PhoneFrame({ locale }: { locale: Locale }) {
  const { apps, visual } = landingFor(locale);
  return (
    <div role="img" aria-label={apps.phoneLabel} className="mx-auto w-56 sm:w-60">
      <div className="rounded-[2.25rem] border-4 border-neutral-800 bg-neutral-800 p-1.5 shadow-raised">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-bg-warm px-3 pt-7 pb-4">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-2 mx-auto block h-1.5 w-14 rounded-full bg-neutral-800"
          />
          <div aria-hidden="true" className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-text">{visual.resultTitle}</span>
              <span className="text-xs text-text-muted">{visual.resultMeta}</span>
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {visual.items.map((item) => (
                <li
                  key={item.name}
                  className={`rounded-lg border px-2 py-1.5 ${
                    item.flag === "review"
                      ? "border-warning bg-warning-soft"
                      : "border-border bg-bg-warm"
                  }`}
                >
                  <p className="text-xs font-bold text-text">{item.name}</p>
                  <p className="text-xs text-text-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1 text-xs text-text-muted">
              <ShieldCheck aria-hidden="true" className="size-3.5 text-success" />
              {visual.note}
            </p>
          </div>
          <p aria-hidden="true" className="mt-2 text-center text-xs text-text-muted">
            {visual.sampleBadge}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "Apps coming soon" band before the final call to action. Server-rendered; only the form is a client island. */
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
        <div className="grid items-center gap-10 rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-10 lg:grid-cols-[auto_1fr] lg:gap-14">
          <PhoneFrame locale={locale} />
          <div>
            <h2 id="apps-title" className="text-2xl font-bold text-text sm:text-3xl">
              {apps.title}
            </h2>
            <p className="mt-3 max-w-reading text-lg text-text-muted">{apps.lead}</p>
            <div className="mt-5">
              <PlatformChips apps={{ androidUrl, iosUrl }} locale={locale} />
            </div>
            {waitlistEnabled ? (
              <div className="mt-8 max-w-md">
                <AppWaitlistForm locale={locale} copy={apps.waitlist} />
              </div>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}

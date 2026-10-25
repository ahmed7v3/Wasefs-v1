import { headers } from "next/headers";

import { ContactHub } from "../../components/contact-hub";
import { SiteFooter } from "../../components/marketing/site-footer";
import { SiteHeader } from "../../components/marketing/site-header";
import { VitalsBeacon } from "../../components/vitals-beacon";
import { hasPublicContent } from "../../lib/content-api";
import { publicEnv } from "../../lib/env";
import { localeFromPath } from "../../lib/locale";
import { getPublicSettings } from "../../lib/public-settings";
import { vitalsRoute } from "../../lib/route-template";

import type { ReactNode } from "react";

/**
 * Frame of the public pages in both languages (landing, legal, contact): header, `main#main`, footer and the floating
 * contact hub. The settings fall back to defaults when the API is down, so none of this can fail.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const [settings, requestHeaders] = await Promise.all([getPublicSettings(), headers()]);
  // `proxy.ts` forwards the request path; the English routes live under `/en`.
  const path = requestHeaders.get("x-pathname") ?? "/";
  const locale = localeFromPath(path);
  // Header and footer links to blog, guides and glossary exist only while they have published items.
  // The layout must not fail a page when the content API is down: no content links then.
  const content = await hasPublicContent(locale).catch(() => ({
    blog: false,
    guides: false,
    glossary: false,
  }));
  return (
    <div className="marketing-type relative isolate flex min-h-dvh flex-col">
      {/* One faint lattice behind the top of every public page (the landing hero included). */}
      <div aria-hidden="true" className="lattice absolute inset-x-0 top-0 -z-10 h-176" />
      <SiteHeader locale={locale} path={path} content={content} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter settings={settings} locale={locale} path={path} content={content} />
      <ContactHub contact={settings.contact} locale={locale} />
      <VitalsBeacon
        route={vitalsRoute(path)}
        endpoint={`${publicEnv.NEXT_PUBLIC_API_URL}/public/vitals`}
      />
    </div>
  );
}

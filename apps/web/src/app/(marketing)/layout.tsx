import { ContactHub } from "../../components/contact-hub";
import { SiteFooter } from "../../components/marketing/site-footer";
import { SiteHeader } from "../../components/marketing/site-header";
import { getPublicSettings } from "../../lib/public-settings";

import type { ReactNode } from "react";

/**
 * Frame of the public pages (landing, legal, contact): header, `main#main`, footer and the floating
 * contact hub. The settings fall back to defaults when the API is down, so none of this can fail.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const settings = await getPublicSettings();
  return (
    <div className="marketing-type page-backdrop flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter settings={settings} />
      <ContactHub contact={settings.contact} />
    </div>
  );
}

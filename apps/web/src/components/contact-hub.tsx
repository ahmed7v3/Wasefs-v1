import { t } from "@wasfa/shared/i18n";

import { contactLinks, type ContactSettings } from "../lib/contact-links";
import { type Locale } from "../lib/locale";

import { ContactHubIsland } from "./contact-hub-island";

/** The site assistant (needs a login: the auth redirect brings the visitor back after sign-in). */
const ASSISTANT_PATH = "/ai";

/**
 * Floating help launcher at the inline-end bottom corner (DESIGN-SYSTEM §5.3). A labelled pill on
 * desktop and a round button on a phone (`compact` keeps it round everywhere, for the app shell).
 * The menu always offers the site assistant, plus WhatsApp first and the other channels the admin
 * configured. A server component on purpose: the label is translated here so the message catalogue
 * stays out of the client bundle of every public page.
 */
export function ContactHub({
  contact,
  locale = "ar",
  compact = false,
}: {
  contact: ContactSettings;
  locale?: Locale;
  compact?: boolean;
}) {
  const links = contactLinks(contact);

  return (
    // Above the layout (z-20), below drawers and dialogs (z-30); clear of the iOS home indicator.
    <div className="fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 print:hidden">
      <ContactHubIsland
        label={t("contactHub.open", undefined, locale)}
        links={links}
        locale={locale}
        compact={compact}
        assistantHref={ASSISTANT_PATH}
      />
    </div>
  );
}

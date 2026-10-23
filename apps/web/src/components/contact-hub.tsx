import { t } from "@wasfa/shared/i18n";

import { contactLinks, type ContactSettings } from "../lib/contact-links";
import { type Locale } from "../lib/locale";

import { ContactHubIsland } from "./contact-hub-island";

/**
 * Floating contact button at the inline-end bottom corner (DESIGN-SYSTEM §5.3). Opens a small
 * menu of the channels the admin configured; renders nothing at all when there are none.
 * A server component on purpose: the label is translated here so the message catalogue stays out
 * of the client bundle of every public page.
 */
export function ContactHub({
  contact,
  locale = "ar",
}: {
  contact: ContactSettings;
  locale?: Locale;
}) {
  const links = contactLinks(contact);
  if (links.length === 0) return null;

  return (
    // Above the layout (z-20), below drawers and dialogs (z-30); clear of the iOS home indicator.
    <div className="fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 print:hidden">
      <ContactHubIsland
        label={t("contactHub.open", undefined, locale)}
        links={links}
        locale={locale}
      />
    </div>
  );
}

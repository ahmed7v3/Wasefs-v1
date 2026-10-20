"use client";

import { t } from "@wasfa/shared/i18n";
import { Headset } from "lucide-react";
import dynamic from "next/dynamic";

import { contactLinks, type ContactSettings } from "../lib/contact-links";
import { type Locale } from "../lib/locale";

import { PopoverMenu } from "./popover-menu";

// The menu items (and their icons) are fetched on the first open, not with every public page.
const ContactHubPanel = dynamic(() => import("./contact-hub-panel"), { ssr: false });

/**
 * Floating contact button at the inline-end bottom corner (DESIGN-SYSTEM §5.3). Opens a small
 * menu of the channels the admin configured; renders nothing at all when there are none.
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
      <PopoverMenu
        label={t("contactHub.open", undefined, locale)}
        placement="above"
        triggerClassName="inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-raised transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
        trigger={<Headset aria-hidden className="size-6" />}
      >
        {(close) => <ContactHubPanel links={links} close={close} locale={locale} />}
      </PopoverMenu>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";

import { type ContactLink } from "../lib/contact-links";
import { type Locale } from "../lib/locale";

import { PopoverMenu } from "./popover-menu";

// The menu items (and their icons) are fetched on the first open, not with every public page.
const ContactHubPanel = dynamic(() => import("./contact-hub-panel"), { ssr: false });

// Lucide's `headset` drawn inline: importing it would ship lucide's icon runtime (~4 KB gzip) with
// every public page just for this one glyph (the panel, loaded on open, keeps using lucide).
function HeadsetIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
      <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
    </svg>
  );
}

/** The client half of the contact hub: just the trigger button; `label` arrives already translated. */
export function ContactHubIsland({
  label,
  links,
  locale,
}: {
  label: string;
  links: ContactLink[];
  locale: Locale;
}) {
  return (
    <PopoverMenu
      label={label}
      placement="above"
      triggerClassName="inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-raised transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
      trigger={<HeadsetIcon />}
    >
      {(close) => <ContactHubPanel links={links} close={close} locale={locale} />}
    </PopoverMenu>
  );
}

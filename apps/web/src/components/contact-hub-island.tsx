"use client";

import dynamic from "next/dynamic";

import { type ContactLink } from "../lib/contact-links";
import { type Locale } from "../lib/locale";

import { PopoverMenu } from "./popover-menu";

// The menu items (and their icons) are fetched on the first open, not with every public page.
const ContactHubPanel = dynamic(() => import("./contact-hub-panel"), { ssr: false });

// Lucide's `message-circle` drawn inline: importing it would ship lucide's icon runtime (~4 KB gzip)
// with every public page just for this one glyph (the panel, loaded on open, keeps using lucide).
function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6 shrink-0"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  );
}

/** A small WhatsApp badge on the launcher: green disc with the speech-bubble-and-handset glyph. */
function WhatsAppBadge() {
  return (
    <span
      aria-hidden="true"
      className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-wa-green text-wa-deep ring-2 ring-white"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" />
        <path
          d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4 4 0 0 1-2.2-2.2l.8-1-1-2L9 8.5Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </span>
  );
}

/**
 * The client half of the contact hub: just the trigger button; `label` arrives already translated.
 * It is both the visible text of the desktop pill and the accessible name (label-in-name), and the
 * only name when the pill collapses to a round button.
 */
export function ContactHubIsland({
  label,
  links,
  locale,
  compact,
  assistantHref,
}: {
  label: string;
  links: ContactLink[];
  locale: Locale;
  compact: boolean;
  assistantHref: string;
}) {
  const hasWhatsapp = links.some((link) => link.channel === "whatsapp");
  return (
    <PopoverMenu
      label={label}
      placement="above"
      panelClassName="w-72 max-w-[calc(100vw-2rem)]"
      triggerClassName={`hub-pulse relative inline-flex size-14 items-center justify-center gap-2.5 rounded-full bg-primary text-base font-bold text-on-primary shadow-raised transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus ${
        compact ? "" : "md:h-14 md:w-auto md:ps-5 md:pe-6"
      }`}
      trigger={
        <>
          <ChatIcon />
          {compact ? null : <span className="hidden whitespace-nowrap md:inline">{label}</span>}
          {hasWhatsapp ? <WhatsAppBadge /> : null}
        </>
      }
    >
      {(close) => (
        <ContactHubPanel
          links={links}
          close={close}
          locale={locale}
          assistantHref={assistantHref}
        />
      )}
    </PopoverMenu>
  );
}

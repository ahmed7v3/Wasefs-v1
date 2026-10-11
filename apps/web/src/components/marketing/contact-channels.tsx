import { t } from "@wasfa/shared/i18n";
import { Mail, MessageCircle, Phone, Send } from "lucide-react";

import { contactLinks, type ContactLink, type ContactSettings } from "../../lib/contact-links";

import type { LucideIcon } from "lucide-react";

const ICONS: Record<ContactLink["channel"], LucideIcon> = {
  whatsapp: MessageCircle,
  telegram: Send,
  phone: Phone,
};

const LABELS = {
  whatsapp: "contactHub.whatsapp",
  telegram: "contactHub.telegram",
  phone: "contactHub.phone",
} as const;

const row =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/** The channels the admin configured; renders nothing when there are none. */
export function ContactChannels({
  contact,
}: {
  contact: ContactSettings & { email: string | null };
}) {
  const links = contactLinks(contact);
  if (links.length === 0 && !contact.email) return null;

  return (
    <section aria-labelledby="channels-title" className="mt-8">
      <h2 id="channels-title" className="font-heading text-xl font-semibold text-text">
        {t("contact.channels.title")}
      </h2>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {links.map((link) => {
          const Icon = ICONS[link.channel];
          return (
            <li key={link.channel}>
              <a
                href={link.href}
                {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={row}
              >
                {/* Telegram's paper plane points to the inline-end, so it mirrors in RTL. */}
                <Icon
                  aria-hidden="true"
                  className={
                    link.channel === "telegram"
                      ? "size-5 text-neutral-600 rtl:-scale-x-100"
                      : "size-5 text-neutral-600"
                  }
                />
                {t(LABELS[link.channel])}
              </a>
            </li>
          );
        })}
        {contact.email ? (
          <li>
            <a href={`mailto:${contact.email}`} className={row}>
              <Mail aria-hidden="true" className="size-5 text-neutral-600" />
              <span dir="ltr">{contact.email}</span>
            </a>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

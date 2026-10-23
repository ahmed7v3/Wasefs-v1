"use client";

import { t } from "@wasfa/shared/i18n/public";
import { MessageCircle, Phone, Send } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ContactLink } from "../lib/contact-links";
import type { Locale } from "../lib/locale";
import type { LucideIcon } from "lucide-react";

const CHANNELS: Record<
  ContactLink["channel"],
  { icon: LucideIcon; label: "contactHub.whatsapp" | "contactHub.telegram" | "contactHub.phone" }
> = {
  whatsapp: { icon: MessageCircle, label: "contactHub.whatsapp" },
  telegram: { icon: Send, label: "contactHub.telegram" },
  phone: { icon: Phone, label: "contactHub.phone" },
};

/**
 * The contact menu items. Loaded on first open (see contact-hub.tsx), so it arrives after the
 * popover's own focus step ran on an empty panel: it moves focus to the first link itself.
 */
export default function ContactHubPanel({
  links,
  close,
  locale,
}: {
  links: ContactLink[];
  close: () => void;
  locale: Locale;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, []);

  return (
    <ul ref={list} aria-label={t("contactHub.menu", undefined, locale)} className="flex flex-col gap-1">
      {links.map((link) => {
        const { icon: Icon, label } = CHANNELS[link.channel];
        return (
          <li key={link.channel}>
            <a
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={close}
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Icon
                aria-hidden
                className={
                  link.channel === "telegram"
                    ? "size-5 text-neutral-600 rtl:-scale-x-100"
                    : "size-5 text-neutral-600"
                }
              />
              {t(label, undefined, locale)}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

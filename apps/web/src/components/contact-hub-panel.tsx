"use client";

import { t } from "@wasfa/shared/i18n/public";
import { ArrowRight, Bot, Phone, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import type { ContactLink } from "../lib/contact-links";
import type { Locale } from "../lib/locale";
import type { LucideIcon } from "lucide-react";

const OTHER: Record<
  Exclude<ContactLink["channel"], "whatsapp">,
  { icon: LucideIcon; label: "contactHub.telegram" | "contactHub.phone" }
> = {
  telegram: { icon: Send, label: "contactHub.telegram" },
  phone: { icon: Phone, label: "contactHub.phone" },
};

const ROW =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/**
 * The contact menu items: WhatsApp first as a full-width green row, then the site assistant, then
 * the other configured channels. Loaded on first open (see contact-hub-island.tsx), so it arrives
 * after the popover's own focus step ran on an empty panel: it moves focus to the first link itself.
 */
export default function ContactHubPanel({
  links,
  close,
  locale,
  assistantHref,
}: {
  links: ContactLink[];
  close: () => void;
  locale: Locale;
  assistantHref: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, []);

  const whatsapp = links.find((link) => link.channel === "whatsapp");
  const others = links.filter((link) => link.channel !== "whatsapp");

  return (
    <ul
      ref={list}
      aria-label={t("contactHub.menu", undefined, locale)}
      className="flex flex-col gap-1"
    >
      {whatsapp ? (
        <li>
          <a
            href={whatsapp.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex min-h-14 items-center gap-3 rounded-xl bg-wa-deep px-3 py-2 text-white transition-colors duration-150 hover:bg-wa-deep/90 focus-visible:outline-none focus-visible:shadow-focus"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-wa-green text-wa-deep">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5"
              >
                <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" />
                <path
                  d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4 4 0 0 1-2.2-2.2l.8-1-1-2L9 8.5Z"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <span className="block text-base font-bold">
                {t("contactHub.whatsappTitle", undefined, locale)}
              </span>
              <span className="block text-sm text-white/90">
                {t("contactHub.whatsappHint", undefined, locale)}
              </span>
            </span>
          </a>
        </li>
      ) : null}
      <li>
        <Link href={assistantHref} onClick={close} className={ROW}>
          <Bot aria-hidden className="size-5 text-neutral-600" />
          <span className="flex-1">{t("contactHub.assistant", undefined, locale)}</span>
          <ArrowRight aria-hidden className="size-4 text-neutral-600 rtl:-scale-x-100" />
        </Link>
      </li>
      {others.map((link) => {
        if (link.channel === "whatsapp") return null;
        const { icon: Icon, label } = OTHER[link.channel];
        return (
          <li key={link.channel}>
            <a
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={close}
              className={ROW}
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

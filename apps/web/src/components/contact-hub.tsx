"use client";

import { t } from "@wasfa/shared/i18n";
import { Headset, MessageCircle, Phone, Send } from "lucide-react";

import { contactLinks, type ContactLink, type ContactSettings } from "../lib/contact-links";

import { PopoverMenu } from "./popover-menu";

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
 * Floating contact button at the inline-end bottom corner (DESIGN-SYSTEM §5.3). Opens a small
 * menu of the channels the admin configured; renders nothing at all when there are none.
 */
export function ContactHub({ contact }: { contact: ContactSettings }) {
  const links = contactLinks(contact);
  if (links.length === 0) return null;

  return (
    // Above the layout (z-20), below drawers and dialogs (z-30); clear of the iOS home indicator.
    <div className="fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20">
      <PopoverMenu
        label={t("contactHub.open")}
        placement="above"
        triggerClassName="inline-flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-raised transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
        trigger={<Headset aria-hidden className="size-6" />}
      >
        {(close) => (
          <ul aria-label={t("contactHub.menu")} className="flex flex-col gap-1">
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
                    {t(label)}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverMenu>
    </div>
  );
}

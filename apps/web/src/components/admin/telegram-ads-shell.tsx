"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADS_BASE } from "../../lib/telegram-ads-admin";

import type { ReactNode } from "react";

const TABS: readonly { href: string; label: MessageKey }[] = [
  { href: ADS_BASE, label: "admin.tgAds.tab.overview" },
  { href: `${ADS_BASE}/campaigns`, label: "admin.tgAds.tab.campaigns" },
  { href: `${ADS_BASE}/creatives`, label: "admin.tgAds.tab.creatives" },
  { href: `${ADS_BASE}/settings`, label: "admin.tgAds.tab.settings" },
];

/** Page frame of the Telegram ads console: title, the four sections as links, then the page. */
export function TelegramAdsShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold text-text">{title}</h1>
        <nav aria-label={t("admin.tgAds.tabs")} className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-lg border px-4 text-base font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-text hover:bg-primary-soft",
                )}
              >
                {t(tab.label)}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}

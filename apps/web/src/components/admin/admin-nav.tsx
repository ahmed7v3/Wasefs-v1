"use client";

import { t } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavActive, visibleNavGroups } from "../../lib/admin-nav";

export interface AdminNavProps {
  permissions: readonly string[];
  /** Called after a link is chosen (the mobile drawer closes itself with it). */
  onNavigate?: (() => void) | undefined;
}

/**
 * Grouped sidebar navigation (the reference layout of `1.png`): small group captions, the active
 * item as a filled navy pill. Items the user has no read permission for are not rendered at all.
 */
export function AdminNav({ permissions, onNavigate }: AdminNavProps) {
  const pathname = usePathname();
  const groups = visibleNavGroups(permissions);

  return (
    <nav aria-label={t("admin.nav.label")} className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="px-3 text-sm font-semibold text-text-muted">{t(group.label)}</p>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isNavActive(item.href, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    {...(onNavigate ? { onClick: onNavigate } : {})}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                      active
                        ? "bg-primary text-on-primary"
                        : "text-text hover:bg-primary-soft hover:text-primary",
                    )}
                  >
                    <Icon aria-hidden className="size-5 shrink-0" />
                    {t(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

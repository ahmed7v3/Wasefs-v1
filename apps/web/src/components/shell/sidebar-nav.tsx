"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { ComingSoonBadge, cn } from "@wasfa/ui";
import { FileScan, House, Pill, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { LucideIcon } from "lucide-react";

interface LinkItem {
  kind: "link";
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Active on this path and everything below it. */
  match: (pathname: string) => boolean;
}

interface SoonItem {
  kind: "soon";
  label: MessageKey;
  icon: LucideIcon;
}

type NavItem = LinkItem | SoonItem;

/*
 * Phase 2 tools are listed as disabled items with a "coming soon" badge so the product's shape is
 * visible, and never as dead links. The admin entry is appended only for callers holding a
 * permission (`showAdmin`).
 */
const ITEMS: readonly NavItem[] = [
  {
    kind: "link",
    href: "/dashboard",
    label: "nav.home",
    icon: House,
    match: (pathname) => pathname === "/dashboard",
  },
  { kind: "soon", label: "nav.analysis", icon: FileScan },
  { kind: "soon", label: "nav.assistant", icon: Sparkles },
  { kind: "soon", label: "nav.drugs", icon: Pill },
  {
    kind: "link",
    href: "/account",
    label: "nav.account",
    icon: UserRound,
    match: (pathname) => pathname === "/account" || pathname.startsWith("/account/"),
  },
];

const ADMIN_ITEM: LinkItem = {
  kind: "link",
  href: "/admin",
  label: "nav.admin",
  icon: ShieldCheck,
  match: (pathname) => pathname === "/admin" || pathname.startsWith("/admin/"),
};

const row = "flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold";

export interface SidebarNavProps {
  /** Icon-only rail (72 px). */
  collapsed?: boolean | undefined;
  /** Called after a link is chosen (the drawer closes itself with it). */
  onNavigate?: (() => void) | undefined;
  showAdmin?: boolean | undefined;
}

export function SidebarNav({ collapsed = false, onNavigate, showAdmin = false }: SidebarNavProps) {
  const pathname = usePathname();
  const items = showAdmin ? [...ITEMS, ADMIN_ITEM] : ITEMS;
  return (
    <nav aria-label={t("nav.main")}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const text = t(item.label);
          if (item.kind === "soon") {
            return (
              <li key={item.label}>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={collapsed ? `${text} (${t("ui.comingSoon")})` : undefined}
                  className={cn(
                    row,
                    "w-full text-start text-text-muted opacity-60",
                    collapsed && "justify-center",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  <span className={cn("flex-1", collapsed && "sr-only")}>{text}</span>
                  <ComingSoonBadge className={cn("text-xs", collapsed && "sr-only")} />
                </button>
              </li>
            );
          }
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? text : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                className={cn(
                  row,
                  "transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                  collapsed && "justify-center",
                  active
                    ? "bg-primary text-on-primary"
                    : "text-text hover:bg-primary-soft hover:text-primary",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className={cn(collapsed && "sr-only")}>{text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

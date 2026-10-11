import {
  Building2,
  Coins,
  Cpu,
  Flag,
  Gauge,
  KeyRound,
  Layers,
  LayoutDashboard,
  MessageCircle,
  Palette,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";

import type { MessageKey } from "@wasfa/shared/i18n";
import type { Permission } from "@wasfa/shared/permissions";
import type { LucideIcon } from "lucide-react";

/*
 * The admin navigation (Task 1.10): one entry per page, grouped as in the reference layout. The nav
 * only HIDES what the signed-in user cannot read; the API is the authority and refuses the rest.
 */

export interface AdminNavItem {
  href: string;
  label: MessageKey;
  description: MessageKey;
  icon: LucideIcon;
  /** The read permission of the page; `null` means any account that may enter the admin area. */
  permission: Permission | null;
}

export interface AdminNavGroup {
  id: string;
  label: MessageKey;
  items: readonly AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: "overview",
    label: "admin.nav.group.overview",
    items: [
      {
        href: "/admin",
        label: "admin.nav.overview",
        description: "admin.nav.overview.description",
        icon: LayoutDashboard,
        permission: null,
      },
    ],
  },
  {
    id: "people",
    label: "admin.nav.group.people",
    items: [
      {
        href: "/admin/users",
        label: "admin.nav.users",
        description: "admin.nav.users.description",
        icon: Users,
        permission: "users.read",
      },
      {
        href: "/admin/orgs",
        label: "admin.nav.orgs",
        description: "admin.nav.orgs.description",
        icon: Building2,
        permission: "orgs.read",
      },
    ],
  },
  {
    id: "access",
    label: "admin.nav.group.access",
    items: [
      {
        href: "/admin/roles",
        label: "admin.nav.roles",
        description: "admin.nav.roles.description",
        icon: ShieldCheck,
        permission: "roles.read",
      },
    ],
  },
  {
    id: "configuration",
    label: "admin.nav.group.configuration",
    items: [
      {
        href: "/admin/settings",
        label: "admin.nav.settings",
        description: "admin.nav.settings.description",
        icon: Settings,
        permission: "settings.read",
      },
      {
        href: "/admin/branding",
        label: "admin.nav.branding",
        description: "admin.nav.branding.description",
        icon: Palette,
        permission: "settings.read",
      },
      {
        href: "/admin/flags",
        label: "admin.nav.flags",
        description: "admin.nav.flags.description",
        icon: Flag,
        permission: "flags.read",
      },
      {
        href: "/admin/whatsapp",
        label: "admin.nav.whatsapp",
        description: "admin.nav.whatsapp.description",
        icon: MessageCircle,
        permission: "settings.read",
      },
    ],
  },
  {
    id: "ai",
    label: "admin.nav.group.ai",
    items: [
      {
        href: "/admin/ai",
        label: "admin.nav.ai",
        description: "admin.nav.ai.description",
        icon: Gauge,
        permission: "ai.read",
      },
      {
        href: "/admin/ai/providers",
        label: "admin.nav.aiProviders",
        description: "admin.nav.aiProviders.description",
        icon: KeyRound,
        permission: "ai.read",
      },
      {
        href: "/admin/ai/models",
        label: "admin.nav.aiModels",
        description: "admin.nav.aiModels.description",
        icon: Cpu,
        permission: "ai.read",
      },
      {
        href: "/admin/ai/routes",
        label: "admin.nav.aiRoutes",
        description: "admin.nav.aiRoutes.description",
        icon: Route,
        permission: "ai.read",
      },
      {
        href: "/admin/plans",
        label: "admin.nav.plans",
        description: "admin.nav.plans.description",
        icon: Layers,
        permission: "plans.read",
      },
      {
        href: "/admin/credits",
        label: "admin.nav.credits",
        description: "admin.nav.credits.description",
        icon: Coins,
        permission: "usage.read",
      },
    ],
  },
  {
    id: "monitoring",
    label: "admin.nav.group.monitoring",
    items: [
      {
        href: "/admin/audit",
        label: "admin.nav.audit",
        description: "admin.nav.audit.description",
        icon: ScrollText,
        permission: "audit.read",
      },
      {
        href: "/admin/issues",
        label: "admin.nav.issues",
        description: "admin.nav.issues.description",
        icon: TriangleAlert,
        permission: "issues.read",
      },
    ],
  },
];

/** True when the list holds the permission (`/me` already expands `super_admin` to the whole catalog). */
export function canAccess(permissions: readonly string[], permission: Permission | null): boolean {
  return permission === null || permissions.includes(permission);
}

/** The groups and items the user may open; a group with no visible item disappears. */
export function visibleNavGroups(permissions: readonly string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccess(permissions, item.permission)),
  })).filter((group) => group.items.length > 0);
}

const NAV_HREFS = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));

const isWithin = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Active on the exact path (overview) or the path and everything below it, unless a longer entry
 * also matches: `/admin/ai/models` is the models page, not the AI settings page it sits under.
 */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (!isWithin(href, pathname)) return false;
  return !NAV_HREFS.some((other) => other.length > href.length && isWithin(other, pathname));
}

/** The nav item of the current path, for the top bar title. */
export function navItemFor(pathname: string): AdminNavItem | undefined {
  return ADMIN_NAV.flatMap((group) => group.items).find((item) => isNavActive(item.href, pathname));
}

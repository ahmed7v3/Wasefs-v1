import {
  Building2,
  Flag,
  LayoutDashboard,
  MessageCircle,
  Palette,
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

/** Active on the exact path (overview) or the path and everything below it. */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item of the current path, for the top bar title. */
export function navItemFor(pathname: string): AdminNavItem | undefined {
  return ADMIN_NAV.flatMap((group) => group.items).find((item) => isNavActive(item.href, pathname));
}

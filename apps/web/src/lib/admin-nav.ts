import {
  Activity,
  ArrowRightLeft,
  Banknote,
  BookA,
  BookOpen,
  CalendarDays,
  Contact,
  File,
  FileText,
  FolderTree,
  Images,
  Inbox,
  Bell,
  BellRing,
  Building2,
  Gift,
  Handshake,
  ShieldAlert,
  Split,
  TrendingUp,
  ClipboardCheck,
  CircleDollarSign,
  CreditCard,
  Coins,
  Cpu,
  Database,
  Flag,
  FlaskConical,
  Gauge,
  KeyRound,
  Sparkles,
  Layers,
  LayoutDashboard,
  MessageCircle,
  Landmark,
  Palette,
  PackageOpen,
  Percent,
  Receipt,
  ReceiptText,
  Repeat,
  Route,
  ScrollText,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Smartphone,
  Tags,
  Ticket,
  TriangleAlert,
  Undo2,
  Users,
  Wallet,
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
  /** Count of work waiting for this page (`GET /admin/billing/counts`); hidden when null or zero. */
  badge?: "paymentsToReview";
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
    id: "revenue",
    label: "admin.nav.group.revenue",
    items: [
      {
        href: "/admin/billing",
        label: "admin.nav.billingOverview",
        description: "admin.nav.billingOverview.description",
        icon: CircleDollarSign,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/payments",
        label: "admin.nav.payments",
        description: "admin.nav.payments.description",
        icon: Wallet,
        permission: "billing.read",
        badge: "paymentsToReview",
      },
      {
        href: "/admin/billing/subscriptions",
        label: "admin.nav.subscriptions",
        description: "admin.nav.subscriptions.description",
        icon: Repeat,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/orders",
        label: "admin.nav.orders",
        description: "admin.nav.orders.description",
        icon: ReceiptText,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/refunds",
        label: "admin.nav.refunds",
        description: "admin.nav.refunds.description",
        icon: Undo2,
        permission: "billing.read",
      },
    ],
  },
  {
    id: "pricing",
    label: "admin.nav.group.pricing",
    items: [
      {
        href: "/admin/billing/plans",
        label: "admin.nav.pricingPlans",
        description: "admin.nav.pricingPlans.description",
        icon: Tags,
        permission: "billing.read",
      },
      {
        href: "/admin/plans",
        label: "admin.nav.plans",
        description: "admin.nav.plans.description",
        icon: Layers,
        permission: "plans.read",
      },
      {
        href: "/admin/billing/credit-packs",
        label: "admin.nav.creditPacks",
        description: "admin.nav.creditPacks.description",
        icon: Coins,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/promotions",
        label: "admin.nav.promotions",
        description: "admin.nav.promotions.description",
        icon: Percent,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/coupons",
        label: "admin.nav.coupons",
        description: "admin.nav.coupons.description",
        icon: Ticket,
        permission: "billing.read",
      },
    ],
  },
  {
    id: "payments",
    label: "admin.nav.group.payments",
    items: [
      {
        href: "/admin/billing/methods",
        label: "admin.nav.paymentMethods",
        description: "admin.nav.paymentMethods.description",
        icon: Landmark,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/gateways",
        label: "admin.nav.gatewaySettings",
        description: "admin.nav.gatewaySettings.description",
        icon: CreditCard,
        permission: "billing.read",
      },
      {
        href: "/admin/billing/settings",
        label: "admin.nav.billingSettings",
        description: "admin.nav.billingSettings.description",
        icon: SlidersHorizontal,
        permission: "settings.read",
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
    id: "growth",
    label: "admin.nav.group.growth",
    items: [
      {
        href: "/admin/growth",
        label: "admin.nav.growthOverview",
        description: "admin.nav.growthOverview.description",
        icon: TrendingUp,
        permission: "referrals.read",
      },
      {
        href: "/admin/growth/referrals",
        label: "admin.nav.referrals",
        description: "admin.nav.referrals.description",
        icon: Gift,
        permission: "referrals.read",
      },
      {
        href: "/admin/growth/fraud",
        label: "admin.nav.fraud",
        description: "admin.nav.fraud.description",
        icon: ShieldAlert,
        permission: "referrals.read",
      },
      {
        href: "/admin/growth/withdrawals",
        label: "admin.nav.withdrawals",
        description: "admin.nav.withdrawals.description",
        icon: Banknote,
        permission: "withdrawals.review",
      },
      {
        href: "/admin/growth/deals",
        label: "admin.nav.deals",
        description: "admin.nav.deals.description",
        icon: Handshake,
        permission: "referrals.read",
      },
      {
        href: "/admin/growth/experiments",
        label: "admin.nav.experiments",
        description: "admin.nav.experiments.description",
        icon: Split,
        permission: "referrals.read",
      },
      {
        href: "/admin/growth/waitlist",
        label: "admin.nav.waitlist",
        description: "admin.nav.waitlist.description",
        icon: Smartphone,
        permission: "users.read",
      },
      {
        href: "/admin/growth/settings",
        label: "admin.nav.growthSettings",
        description: "admin.nav.growthSettings.description",
        icon: SlidersHorizontal,
        permission: "settings.read",
      },
    ],
  },
  {
    id: "notifications",
    label: "admin.nav.group.notifications",
    items: [
      {
        href: "/admin/alerts",
        label: "admin.nav.alerts",
        description: "admin.nav.alerts.description",
        icon: BellRing,
        permission: "alerts.receive",
      },
      {
        href: "/admin/notifications",
        label: "admin.nav.notifications",
        description: "admin.nav.notifications.description",
        icon: Bell,
        permission: "alerts.receive",
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
    id: "content",
    label: "admin.nav.group.content",
    items: [
      {
        href: "/admin/content?type=article",
        label: "admin.nav.content.articles",
        description: "admin.nav.content.articles.description",
        icon: FileText,
        permission: "content.read",
      },
      {
        href: "/admin/content?type=guide",
        label: "admin.nav.content.guides",
        description: "admin.nav.content.guides.description",
        icon: BookOpen,
        permission: "content.read",
      },
      {
        href: "/admin/content?type=glossary",
        label: "admin.nav.content.glossary",
        description: "admin.nav.content.glossary.description",
        icon: BookA,
        permission: "content.read",
      },
      {
        href: "/admin/content?type=page",
        label: "admin.nav.content.pages",
        description: "admin.nav.content.pages.description",
        icon: File,
        permission: "content.read",
      },
      {
        href: "/admin/content/review",
        label: "admin.nav.content.review",
        description: "admin.nav.content.review.description",
        icon: Inbox,
        permission: "content.read",
      },
      {
        href: "/admin/content/calendar",
        label: "admin.nav.content.calendar",
        description: "admin.nav.content.calendar.description",
        icon: CalendarDays,
        permission: "content.read",
      },
      {
        href: "/admin/media",
        label: "admin.nav.content.media",
        description: "admin.nav.content.media.description",
        icon: Images,
        permission: "content.read",
      },
      {
        href: "/admin/content/taxonomy",
        label: "admin.nav.content.taxonomy",
        description: "admin.nav.content.taxonomy.description",
        icon: FolderTree,
        permission: "content.read",
      },
      {
        href: "/admin/content/people",
        label: "admin.nav.content.people",
        description: "admin.nav.content.people.description",
        icon: Contact,
        permission: "content.read",
      },
      {
        href: "/admin/content/redirects",
        label: "admin.nav.content.redirects",
        description: "admin.nav.content.redirects.description",
        icon: ArrowRightLeft,
        permission: "content.read",
      },
      {
        // A deep link to the `content` group of the general settings page; never "active" itself.
        href: "/admin/settings#group-content",
        label: "admin.nav.content.settings",
        description: "admin.nav.content.settings.description",
        icon: SlidersHorizontal,
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
        href: "/admin/ai/skills",
        label: "admin.nav.aiSkills",
        description: "admin.nav.aiSkills.description",
        icon: Sparkles,
        permission: "ai.read",
      },
      {
        href: "/admin/ai/playground",
        label: "admin.nav.aiPlayground",
        description: "admin.nav.aiPlayground.description",
        icon: FlaskConical,
        // Visible to readers like every nav entry; running it needs ai.write and the page says so.
        permission: "ai.read",
      },
      {
        href: "/admin/ai/usage",
        label: "admin.nav.aiUsage",
        description: "admin.nav.aiUsage.description",
        icon: Receipt,
        permission: "usage.read",
      },
      {
        href: "/admin/ai/evals",
        label: "admin.nav.aiEvals",
        description: "admin.nav.aiEvals.description",
        icon: ClipboardCheck,
        permission: "evals.run",
      },
    ],
  },
  {
    id: "drugs",
    label: "admin.nav.group.drugs",
    items: [
      {
        href: "/admin/drugs",
        label: "admin.nav.drugs",
        description: "admin.nav.drugs.description",
        icon: Database,
        permission: "drugs.read",
      },
      {
        href: "/admin/drugs/imports",
        label: "admin.nav.drugImports",
        description: "admin.nav.drugImports.description",
        icon: PackageOpen,
        permission: "drugs.read",
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
        href: "/admin/site-health",
        label: "admin.nav.siteHealth",
        description: "admin.nav.siteHealth.description",
        icon: Activity,
        permission: "settings.read",
      },
      {
        href: "/admin/flags",
        label: "admin.nav.flags",
        description: "admin.nav.flags.description",
        icon: Flag,
        permission: "flags.read",
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

/** Path, query and hash of a nav href (`/admin/content?type=guide`, `/admin/settings#group-content`). */
function parseHref(href: string): { path: string; query: URLSearchParams; hash: boolean } {
  const [beforeHash = "", hash] = href.split("#");
  const [path = "", query = ""] = beforeHash.split("?");
  return { path, query: new URLSearchParams(query), hash: hash !== undefined };
}

const NAV_PATHS = ADMIN_NAV.flatMap((group) =>
  group.items.map((item) => parseHref(item.href).path),
);

const isWithin = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Active on the exact path (overview) or the path and everything below it, unless a longer entry
 * also matches: `/admin/ai/models` is the models page, not the AI settings page it sits under.
 * An entry with a query (`/admin/content?type=guide`) is active only on exactly that path with
 * those params; an entry with a hash is a deep link and is never the current page.
 */
export function isNavActive(
  href: string,
  pathname: string,
  search: string | URLSearchParams = "",
): boolean {
  const { path, query, hash } = parseHref(href);
  if (hash) return false;
  if (query.size > 0) {
    if (pathname !== path) return false;
    const current = typeof search === "string" ? new URLSearchParams(search) : search;
    return [...query].every(([name, value]) => current.get(name) === value);
  }
  if (path === "/admin") return pathname === "/admin";
  if (!isWithin(path, pathname)) return false;
  return !NAV_PATHS.some((other) => other.length > path.length && isWithin(other, pathname));
}

/** The nav item of the current path, for the top bar title. */
export function navItemFor(
  pathname: string,
  search: string | URLSearchParams = "",
): AdminNavItem | undefined {
  return ADMIN_NAV.flatMap((group) => group.items).find((item) =>
    isNavActive(item.href, pathname, search),
  );
}

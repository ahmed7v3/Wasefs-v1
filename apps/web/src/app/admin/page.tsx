import { t } from "@wasfa/shared/i18n";
import { Card, CardTitle } from "@wasfa/ui";
import { Building2, TriangleAlert, UserCheck, UserPlus, UserRoundX, Users } from "lucide-react";
import Link from "next/link";

import { StatCard } from "../../components/admin/stat-card";
import { Notice } from "../../components/notice";
import { canAccess, visibleNavGroups } from "../../lib/admin-nav";
import { getAdminStats } from "../../lib/admin-server";
import { requireMe } from "../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.overview") };

export default async function AdminOverviewPage() {
  const me = await requireMe("/admin");
  // The stats route is gated by `users.read`; an account with other permissions sees the shortcuts only.
  const stats = canAccess(me.permissions, "users.read") ? await getAdminStats() : null;
  const sections = visibleNavGroups(me.permissions)
    .flatMap((group) => group.items)
    .filter((item) => item.href !== "/admin");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg text-text-muted">{t("admin.overview.lead", { name: me.name })}</p>

      {stats ? (
        <section aria-labelledby="stats-title" className="flex flex-col gap-3">
          <h2 id="stats-title" className="sr-only">
            {t("admin.overview.statsTitle")}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <li>
              <StatCard
                label={t("admin.stats.users")}
                value={stats.users.total}
                icon={Users}
                href={canAccess(me.permissions, "users.read") ? "/admin/users" : undefined}
              />
            </li>
            <li>
              <StatCard
                label={t("admin.stats.active")}
                value={stats.users.active}
                icon={UserCheck}
                accent="success"
                href="/admin/users?status=active"
              />
            </li>
            <li>
              <StatCard
                label={t("admin.stats.suspended")}
                value={stats.users.suspended}
                icon={UserRoundX}
                accent="danger"
                href="/admin/users?status=suspended"
              />
            </li>
            <li>
              <StatCard
                label={t("admin.stats.newLast7Days")}
                value={stats.users.newLast7Days}
                icon={UserPlus}
              />
            </li>
            <li>
              <StatCard
                label={t("admin.stats.orgs")}
                value={stats.orgs.total}
                icon={Building2}
                href={canAccess(me.permissions, "orgs.read") ? "/admin/orgs" : undefined}
              />
            </li>
            <li>
              <StatCard
                label={t("admin.stats.openIssues")}
                value={stats.issues.open}
                icon={TriangleAlert}
                accent="warning"
                href={canAccess(me.permissions, "issues.read") ? "/admin/issues" : undefined}
              />
            </li>
          </ul>
        </section>
      ) : (
        <Notice>{t("admin.overview.noStats")}</Notice>
      )}

      <section aria-labelledby="shortcuts-title" className="flex flex-col gap-3">
        <CardTitle id="shortcuts-title">{t("admin.overview.shortcuts")}</CardTitle>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block h-full rounded-xl focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <Card
                    elevation="flat"
                    padding="compact"
                    className="flex h-full items-start gap-4 transition-colors duration-150 hover:bg-primary-soft/40"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
                    >
                      <Icon className="size-6" />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-base font-semibold text-text">{t(item.label)}</span>
                      <span className="text-sm text-text-muted">{t(item.description)}</span>
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

"use client";

import { t } from "@wasfa/shared/i18n";
import { orgDashboardSchema } from "@wasfa/shared/schemas/org";
import { Badge, EmptyState, Skeleton, Tab, TabList, TabPanel, Tabs, buttonStyles } from "@wasfa/ui";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

import { ApiRequestError } from "../../lib/api-error";
import { fetchOrgOrders, orgDashboardPath } from "../../lib/org-api";
import { useResource } from "../../lib/use-admin-data";
import { OrderHistory } from "../billing/order-history";
import { ErrorNotice } from "../error-notice";

import { JoinLinksTab } from "./join-links-tab";
import { MembersTab } from "./members-tab";
import { OverviewTab } from "./overview-tab";

export interface OrgDashboardProps {
  orgId: string;
  /** Plan and pack names by key, for the orders list. */
  names: Readonly<Record<string, string>>;
}

/** A calm page for someone who is not an admin of this organization (or not a member at all). */
function NoAccess() {
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={t("org.noAccess.title")}
      description={t("org.noAccess.body")}
      action={
        <Link href="/dashboard" className={buttonStyles()}>
          {t("invite.toDashboard")}
        </Link>
      }
    />
  );
}

/** The organization admin console: overview, members, join links and orders and receipts. */
export function OrgDashboard({ orgId, names }: OrgDashboardProps) {
  const dashboard = useResource(orgDashboardPath(orgId), orgDashboardSchema);
  const fetchPage = useCallback((cursor?: string) => fetchOrgOrders(orgId, cursor), [orgId]);
  const receiptHref = useCallback(
    (orderId: string) => `/org/${orgId}/orders/${orderId}/receipt`,
    [orgId],
  );

  if (dashboard.status === "loading") {
    return (
      <div role="status" aria-label={t("ui.loading")} className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (dashboard.status === "error") {
    const refused =
      dashboard.error instanceof ApiRequestError &&
      (dashboard.error.code === "FORBIDDEN" || dashboard.error.code === "NOT_FOUND");
    return refused ? (
      <NoAccess />
    ) : (
      <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />
    );
  }

  const { data } = dashboard;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-4xl">
          {data.org.name}
        </h1>
        <p className="text-base text-text-muted sm:text-lg">{t("org.lead")}</p>
      </header>

      <Tabs defaultValue="overview">
        <TabList aria-label={t("org.tabs.label")}>
          <Tab value="overview">{t("org.tabs.overview")}</Tab>
          <Tab value="members">
            {t("org.tabs.members")}
            {data.pendingMembers.length > 0 ? (
              <Badge tone="warning" className="ms-2">
                {data.pendingMembers.length}
                <span className="sr-only"> {t("org.tabs.pendingSr")}</span>
              </Badge>
            ) : null}
          </Tab>
          <Tab value="links">{t("org.tabs.links")}</Tab>
          <Tab value="orders">{t("org.tabs.orders")}</Tab>
        </TabList>
        <TabPanel value="overview">
          <OverviewTab orgId={orgId} dashboard={data} />
        </TabPanel>
        <TabPanel value="members">
          <MembersTab
            orgId={orgId}
            members={data.members}
            pending={data.pendingMembers}
            onChanged={dashboard.reload}
          />
        </TabPanel>
        <TabPanel value="links">
          <JoinLinksTab orgId={orgId} onChanged={dashboard.reload} />
        </TabPanel>
        <TabPanel value="orders">
          <section aria-labelledby="org-orders-title" className="flex flex-col gap-3">
            <h2 id="org-orders-title" className="font-heading text-xl font-bold text-text">
              {t("org.orders.title")}
            </h2>
            <OrderHistory
              names={names}
              fetchPage={fetchPage}
              receiptHref={receiptHref}
              canComplete={false}
            />
          </section>
        </TabPanel>
      </Tabs>
    </div>
  );
}

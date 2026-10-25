"use client";

import { t } from "@wasfa/shared/i18n";
import { type Permission } from "@wasfa/shared/permissions";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  moneyText,
  useToast,
} from "@wasfa/ui";
import { ArrowUpCircle, Coins, Eye, NotebookPen } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { canAccess } from "../../lib/admin-nav";
import {
  revealedContactSchema,
  userSummarySchema,
  type UserSummary,
} from "../../lib/admin-user-360";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { AdjustCreditsDialog } from "./adjust-credits-dialog";
import { PlanChangeDialog } from "./plan-change-dialog";
import { ReasonDialog } from "./reason-dialog";
import { ResourceBoundary } from "./resource-boundary";
import {
  BillingTab,
  ChatsTab,
  CreditsTab,
  NotesTab,
  PrescriptionsTab,
  ReferralsTab,
  TimelineTab,
} from "./user-360-tabs";
import { CopyableUserId, ProviderChips } from "./user-identity";

/** The permission each tab needs; `notes` and `overview` only need the page's own `users.read`. */
const TAB_PERMISSION: Record<string, Permission> = {
  overview: "users.read",
  notes: "users.read",
  billing: "billing.read",
  credits: "usage.read",
  prescriptions: "users.read_health",
  chats: "users.read_chats",
  referrals: "referrals.read",
};

export interface User360ViewProps {
  userId: string;
  permissions: readonly string[];
}

function Chips({ summary }: { summary: UserSummary }) {
  const { chips } = summary;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={chips.emailVerified ? "success" : "neutral"}>
        {t(
          chips.emailVerified
            ? "admin.user360.chip.emailVerified"
            : "admin.user360.chip.emailUnverified",
        )}
      </Badge>
      <Badge tone={chips.phoneVerified ? "success" : "neutral"}>
        {t(
          chips.phoneVerified
            ? "admin.user360.chip.phoneVerified"
            : "admin.user360.chip.phoneUnverified",
        )}
      </Badge>
      {chips.twoFactorEnabled ? (
        <Badge tone="info">{t("admin.user360.chip.twoFactor")}</Badge>
      ) : null}
      {chips.suspended ? <Badge tone="danger">{t("admin.user360.chip.suspended")}</Badge> : null}
      <Badge
        tone={summary.plan.status === "active" ? "success" : "neutral"}
        data-testid="plan-chip"
      >
        {summary.plan.expiresAt
          ? t("admin.user360.chip.planUntil", {
              plan: summary.plan.nameAr,
              date: formatDateTime(summary.plan.expiresAt),
            })
          : summary.plan.nameAr}
      </Badge>
    </div>
  );
}

function ContactLine({ userId, summary }: { userId: string; summary: UserSummary }) {
  const { toast } = useToast();
  const [field, setField] = useState<"email" | "phone" | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<"email" | "phone", string>>>({});
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-1 text-base text-text">
      {(["email", "phone"] as const).map((key) =>
        summary.contact[key] ? (
          <span key={key} className="flex min-w-0 max-w-full items-center gap-2">
            <bdi dir="ltr" className="min-w-0 [overflow-wrap:anywhere]">
              {revealed[key] ?? summary.contact[key]}
            </bdi>
            {revealed[key] ? null : (
              <Button
                variant="ghost"
                aria-label={t(`admin.user360.reveal.${key}`)}
                onClick={() => {
                  setField(key);
                }}
              >
                <Eye aria-hidden className="size-4" />
              </Button>
            )}
          </span>
        ) : null,
      )}
      <ReasonDialog
        open={field !== null}
        onOpenChange={(open) => {
          if (!open) setField(null);
        }}
        title={t("admin.user360.reveal.title")}
        effect={t("admin.user360.reveal.effect")}
        confirmLabel={t("admin.user360.reveal.confirm")}
        onConfirm={async (reason) => {
          if (field === null) return;
          const value = await api(`/admin/users/${userId}/reveal-contact`, {
            method: "POST",
            body: { field, reason },
            schema: revealedContactSchema,
          });
          if (value.value)
            setRevealed((current) => ({ ...current, [field]: value.value ?? undefined }));
          else toast({ tone: "info", title: t("admin.user360.reveal.none") });
          setField(null);
        }}
      />
    </div>
  );
}

function SummaryStrip({ summary }: { summary: UserSummary }) {
  const revenue = Object.entries(summary.lifetimeRevenue);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <dt className="text-sm text-text-muted">{t("admin.user360.memberSince")}</dt>
        <dd className="text-text">{formatDateTime(summary.memberSince)}</dd>
      </div>
      <div>
        <dt className="text-sm text-text-muted">{t("admin.user360.lastSeen")}</dt>
        <dd className="text-text">
          {summary.lastSeenAt ? formatDateTime(summary.lastSeenAt) : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-text-muted">{t("admin.user360.revenue")}</dt>
        <dd className="text-text tabular-nums">
          {revenue.length === 0
            ? "—"
            : revenue.map(([currency, minor]) => moneyText(minor, currency)).join(" · ")}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-text-muted">{t("admin.user360.aiCost")}</dt>
        <dd className="text-text tabular-nums">{`$${(summary.lifetimeAiCostUsdMicros / 1_000_000).toFixed(2)}`}</dd>
      </div>
      <div>
        <dt className="text-sm text-text-muted">{t("admin.user360.source")}</dt>
        <dd className="text-text">
          {summary.referralSource
            ? `${summary.referralSource.code ?? ""} ${summary.referralSource.referrerInitials ? `· ${summary.referralSource.referrerInitials}` : ""}`.trim()
            : t("admin.user360.sourceNone")}
        </dd>
      </div>
    </dl>
  );
}

/**
 * `/admin/users/<id>` (ADMIN-CONSOLE-SPEC §8): the page support lives in. Header with the status
 * chips, plan and wallets, the actions (change plan, credits, note), a summary strip, and the tabs
 * the caller's permissions allow. Health data (prescriptions, chats) opens only inside a reasoned,
 * audited 30-minute access session; lists show metadata only.
 */
export function User360View({ userId, permissions }: User360ViewProps) {
  const summary = useResource(`/admin/users/${userId}/summary`, userSummarySchema);
  const [changing, setChanging] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const can = (permission: Permission) => canAccess(permissions, permission);
  // `?tab=` picks the first tab (the users drawer links to `prescriptions`); a tab the caller may not
  // see falls back to the overview.
  const requested = useSearchParams().get("tab");
  const [tab, setTab] = useState(
    requested &&
      Object.hasOwn(TAB_PERMISSION, requested) &&
      can(TAB_PERMISSION[requested] ?? "users.read")
      ? requested
      : "overview",
  );

  return (
    <ResourceBoundary resource={summary}>
      {(data) => (
        <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl flex-col gap-6">
          <Card elevation="card" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 max-w-full flex-1 basis-80 flex-col items-start gap-2">
                <div className="flex min-w-0 max-w-full items-center gap-3">
                  <Avatar name={data.profile.name} src={data.profile.image} size={56} />
                  <h1
                    className="line-clamp-2 min-w-0 font-heading text-2xl font-bold text-primary [overflow-wrap:anywhere] sm:text-3xl"
                    data-testid="user-name"
                  >
                    {data.profile.name}
                  </h1>
                </div>
                <CopyableUserId id={data.profile.id} />
                <ProviderChips providers={data.profile.providers} />
                <Chips summary={data} />
                <ContactLine userId={userId} summary={data} />
              </div>
              <div className="flex flex-wrap gap-2">
                {can("users.upgrade") ? (
                  <Button
                    name="open-plan-change"
                    onClick={() => {
                      setChanging(true);
                    }}
                  >
                    <ArrowUpCircle aria-hidden className="size-4" />
                    {t("admin.user360.action.plan")}
                  </Button>
                ) : null}
                {can("credits.adjust") ? (
                  <Button
                    variant="secondary"
                    name="adjust-credits"
                    onClick={() => {
                      setAdjusting(true);
                    }}
                  >
                    <Coins aria-hidden className="size-4" />
                    {t("admin.user360.action.credits")}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  name="note"
                  onClick={() => {
                    setTab("notes");
                  }}
                >
                  <NotebookPen aria-hidden className="size-4" />
                  {t("admin.user360.action.note")}
                </Button>
              </div>
            </div>
            <p className="text-base text-text">
              {t("admin.user360.walletLine", {
                balance: formatNumber(data.wallets.personal.balance),
              })}
              {data.wallets.orgs
                .map((org) => ` · ${org.name}: ${formatNumber(org.balance)}`)
                .join("")}
            </p>
            <SummaryStrip summary={data} />
          </Card>

          <Tabs value={tab} onValueChange={setTab}>
            <TabList aria-label={t("admin.user360.tabs")} className="flex-wrap">
              <Tab value="overview">{t("admin.user360.tab.overview")}</Tab>
              {can("billing.read") ? (
                <Tab value="billing">{t("admin.user360.tab.billing")}</Tab>
              ) : null}
              {can("usage.read") ? (
                <Tab value="credits">{t("admin.user360.tab.credits")}</Tab>
              ) : null}
              {can("users.read_health") ? (
                <Tab value="prescriptions">{t("admin.user360.tab.prescriptions")}</Tab>
              ) : null}
              {can("users.read_chats") ? (
                <Tab value="chats">{t("admin.user360.tab.chats")}</Tab>
              ) : null}
              {can("referrals.read") ? (
                <Tab value="referrals">{t("admin.user360.tab.referrals")}</Tab>
              ) : null}
              <Tab value="notes">{t("admin.user360.tab.notes")}</Tab>
            </TabList>
            <TabPanel value="overview" className="pt-4">
              <TimelineTab userId={userId} />
            </TabPanel>
            {can("billing.read") ? (
              <TabPanel value="billing" className="pt-4">
                {tab === "billing" ? <BillingTab userId={userId} /> : null}
              </TabPanel>
            ) : null}
            {can("usage.read") ? (
              <TabPanel value="credits" className="pt-4">
                {tab === "credits" ? <CreditsTab userId={userId} /> : null}
              </TabPanel>
            ) : null}
            {can("users.read_health") ? (
              <TabPanel value="prescriptions" className="pt-4">
                {tab === "prescriptions" ? <PrescriptionsTab userId={userId} /> : null}
              </TabPanel>
            ) : null}
            {can("users.read_chats") ? (
              <TabPanel value="chats" className="pt-4">
                {tab === "chats" ? <ChatsTab userId={userId} /> : null}
              </TabPanel>
            ) : null}
            {can("referrals.read") ? (
              <TabPanel value="referrals" className="pt-4">
                {tab === "referrals" ? <ReferralsTab userId={userId} /> : null}
              </TabPanel>
            ) : null}
            <TabPanel value="notes" className="pt-4">
              {tab === "notes" ? <NotesTab userId={userId} /> : null}
            </TabPanel>
          </Tabs>

          <PlanChangeDialog
            open={changing}
            base={`/admin/users/${userId}`}
            targetName={data.profile.name}
            onClose={() => {
              setChanging(false);
            }}
            onChanged={summary.reload}
          />
          <AdjustCreditsDialog
            open={adjusting}
            target={{
              owner: { type: "user", id: userId },
              label: data.profile.name,
              balance: data.wallets.personal.balance,
            }}
            knownWallets={[
              { owner: { type: "user", id: userId }, balance: data.wallets.personal.balance },
            ]}
            onClose={() => {
              setAdjusting(false);
            }}
            onAdjusted={summary.reload}
          />
        </div>
      )}
    </ResourceBoundary>
  );
}

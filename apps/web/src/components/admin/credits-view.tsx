"use client";

import { t } from "@wasfa/shared/i18n";
import { microsToUsd } from "@wasfa/shared/money";
import { aiSettingsResponseSchema } from "@wasfa/shared/schemas/admin-ai";
import {
  adminCreditWalletPageSchema,
  creditLedgerPageSchema,
  type AdminCreditWallet,
  type CreditLedgerEntryView,
} from "@wasfa/shared/schemas/credits";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { Badge, Button, Card, type BadgeTone } from "@wasfa/ui";
import { Coins, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import { ownerTypeLabel } from "../../lib/admin-billing";
import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { AdjustCreditsDialog, type AdjustTarget } from "./adjust-credits-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { DetailDrawer } from "./drawer";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

export interface CreditsViewProps {
  /** `credits.adjust`: add or deduct credits. */
  canAdjust: boolean;
  /** `ai.read`: the page can tell what one credit is worth. */
  canReadAi: boolean;
  /** `plans.read`: the page can tell what the default plan grants every month. */
  canReadPlans: boolean;
}

const KIND_TONES: Record<CreditLedgerEntryView["kind"], BadgeTone> = {
  grant: "success",
  admin_adjust: "info",
  usage_reserve: "neutral",
  usage_settle: "neutral",
  release: "neutral",
  refund: "info",
  expiry: "warning",
};

const kindKey = {
  grant: "admin.credits.kind.grant",
  admin_adjust: "admin.credits.kind.admin_adjust",
  usage_reserve: "admin.credits.kind.usage_reserve",
  usage_settle: "admin.credits.kind.usage_settle",
  release: "admin.credits.kind.release",
  refund: "admin.credits.kind.refund",
  expiry: "admin.credits.kind.expiry",
} as const;

/** `+12` / `−5`: the sign is text as well as colour. Always a left-to-right run. */
function SignedAmount({ value }: { value: number }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-text";
  return (
    <span dir="ltr" className={`inline-block font-semibold tabular-nums ${tone}`}>
      {sign}
      {formatNumber(Math.abs(value))}
    </span>
  );
}

function Balance({ value }: { value: number }) {
  return (
    <span dir="ltr" className="inline-block tabular-nums">
      {formatNumber(value)}
    </span>
  );
}

const ledgerColumns = (): DataTableColumn<CreditLedgerEntryView>[] => [
  {
    id: "date",
    header: t("admin.credits.ledger.col.date"),
    primary: true,
    cell: (entry) => formatDateTime(entry.createdAt),
  },
  {
    id: "kind",
    header: t("admin.credits.ledger.col.kind"),
    cell: (entry) => <Badge tone={KIND_TONES[entry.kind]}>{t(kindKey[entry.kind])}</Badge>,
  },
  {
    id: "amount",
    header: t("admin.credits.ledger.col.amount"),
    cell: (entry) => <SignedAmount value={entry.amount} />,
  },
  {
    id: "balance",
    header: t("admin.credits.ledger.col.balance"),
    cell: (entry) => <Balance value={entry.balanceAfter} />,
  },
  {
    id: "reason",
    header: t("admin.credits.ledger.col.reason"),
    cell: (entry) => entry.reason ?? "—",
  },
];

/** The ledger of one wallet, newest first, in a drawer. */
function Ledger({ wallet }: { wallet: AdminCreditWallet }) {
  const list = useCursorList(
    `/admin/credits/wallets/${wallet.id}/ledger`,
    "",
    creditLedgerPageSchema,
  );
  return (
    <DataTable
      caption={t("admin.credits.ledger.title")}
      columns={ledgerColumns()}
      rows={list.items}
      rowKey={(entry) => entry.id}
      status={list.status}
      error={list.error}
      onRetry={list.reload}
      nextCursor={list.nextCursor}
      loadingMore={list.loadingMore}
      loadMoreError={list.loadMoreError}
      onLoadMore={list.loadMore}
      emptyTitle={t("admin.credits.ledger.empty")}
    />
  );
}

function ownerName(wallet: AdminCreditWallet): string {
  return wallet.ownerName ?? wallet.ownerEmail ?? wallet.owner.id;
}

/**
 * Credit wallets (Decision 3): the list with search, the ledger of a wallet in a drawer and the
 * balance adjustment. Credits only ever move through the ledger, so the page has no other write.
 */
export function CreditsView({ canAdjust, canReadAi, canReadPlans }: CreditsViewProps) {
  const url = useUrlParams();
  const settings = useResource(canReadAi ? "/admin/ai/settings" : null, aiSettingsResponseSchema);
  const plans = useResource(canReadPlans ? "/admin/plans" : null, planListResponseSchema);

  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "search",
        name: "q",
        label: t("admin.credits.filter.q"),
        placeholder: t("admin.credits.filter.qHint"),
      },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/credits/wallets",
    buildQuery({ q: url.get("q") }),
    adminCreditWalletPageSchema,
  );

  const [openId, setOpenId] = useState<string | null>(null);
  // `undefined` = closed; `null` = open for a typed owner; a target = open for that wallet.
  const [adjusting, setAdjusting] = useState<AdjustTarget | null | undefined>(undefined);
  // Bumped after an adjustment so the open ledger reloads.
  const [ledgerVersion, setLedgerVersion] = useState(0);

  const openWallet = list.items.find((wallet) => wallet.id === openId) ?? null;

  const targetOf = (wallet: AdminCreditWallet): AdjustTarget => ({
    owner: wallet.owner,
    label: ownerName(wallet),
    balance: wallet.balance,
  });

  const columns: DataTableColumn<AdminCreditWallet>[] = [
    {
      id: "owner",
      header: t("admin.credits.col.owner"),
      primary: true,
      cell: (wallet) => (
        <span className="flex flex-col">
          <span>{wallet.ownerName ?? "—"}</span>
          {wallet.ownerEmail ? (
            <span className="text-sm font-normal text-text-muted" dir="ltr">
              {wallet.ownerEmail}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "type",
      header: t("admin.credits.col.type"),
      cell: (wallet) => <Badge tone="neutral">{ownerTypeLabel(wallet.owner.type)}</Badge>,
    },
    {
      id: "balance",
      header: t("admin.credits.col.balance"),
      cell: (wallet) => <Balance value={wallet.balance} />,
    },
    { id: "plan", header: t("admin.credits.col.plan"), cell: (wallet) => wallet.plan.nameAr },
    {
      id: "updated",
      header: t("admin.credits.col.updated"),
      cell: (wallet) => formatDateTime(wallet.updatedAt),
    },
  ];

  const rowActions = (wallet: AdminCreditWallet): RowAction[] => {
    const actions: RowAction[] = [
      {
        id: "ledger",
        label: t("admin.credits.ledger.open"),
        icon: ScrollText,
        onSelect: () => {
          setOpenId(wallet.id);
        },
      },
    ];
    if (canAdjust) {
      actions.push({
        id: "adjust",
        label: t("admin.credits.adjust.open"),
        icon: Coins,
        onSelect: () => {
          setAdjusting(targetOf(wallet));
        },
      });
    }
    return actions;
  };

  const creditValue =
    settings.status === "ready" ? microsToUsd(settings.data.value.creditValueUsdMicros) : undefined;
  const defaultPlan =
    plans.status === "ready" ? plans.data.items.find((plan) => plan.isDefault) : undefined;

  return (
    <div className="flex flex-col gap-5">
      {creditValue !== undefined || defaultPlan ? (
        <Card elevation="flat" padding="compact" className="flex flex-col gap-1 text-base">
          {creditValue !== undefined ? (
            <p>
              {t("admin.credits.creditValue")}{" "}
              <span dir="ltr" className="font-semibold tabular-nums">
                ${creditValue}
              </span>
            </p>
          ) : null}
          {defaultPlan ? (
            <p>
              {t("admin.credits.freeGrant", {
                plan: defaultPlan.nameAr,
                credits: formatNumber(defaultPlan.monthlyCredits),
              })}
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <FilterBar fields={fields} />
        </div>
        {canAdjust ? (
          <Button
            name="adjust-balance"
            onClick={() => {
              setAdjusting(null);
            }}
          >
            <Coins aria-hidden className="size-5" />
            {t("admin.credits.adjust.open")}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.credits.title")}
        columns={columns}
        rows={list.items}
        rowKey={(wallet) => wallet.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(wallet) => {
          setOpenId(wallet.id);
        }}
        openLabel={(wallet) => t("admin.credits.ledger.openFor", { name: ownerName(wallet) })}
        rowActions={rowActions}
        actionsLabel={(wallet) => t("admin.table.actionsFor", { name: ownerName(wallet) })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null });
        }}
        emptyTitle={t("admin.credits.empty")}
        emptyDescription={t("admin.credits.emptyBody")}
      />

      <DetailDrawer
        open={openWallet !== null}
        onClose={() => {
          setOpenId(null);
        }}
        title={openWallet ? ownerName(openWallet) : t("admin.credits.ledger.title")}
      >
        {openWallet ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1 text-base">
                <span>
                  {t("admin.credits.col.balance")}:{" "}
                  <span className="font-semibold">
                    <Balance value={openWallet.balance} />
                  </span>
                </span>
                <span className="text-sm text-text-muted">
                  {ownerTypeLabel(openWallet.owner.type)} · {openWallet.plan.nameAr}
                </span>
              </div>
              {canAdjust ? (
                <Button
                  variant="secondary"
                  name="adjust-wallet"
                  onClick={() => {
                    setAdjusting(targetOf(openWallet));
                  }}
                >
                  <Coins aria-hidden className="size-5" />
                  {t("admin.credits.adjust.open")}
                </Button>
              ) : null}
            </div>
            <Ledger key={`${openWallet.id}:${String(ledgerVersion)}`} wallet={openWallet} />
          </>
        ) : null}
      </DetailDrawer>

      <AdjustCreditsDialog
        open={adjusting !== undefined}
        target={adjusting ?? null}
        knownWallets={list.items}
        onClose={() => {
          setAdjusting(undefined);
        }}
        onAdjusted={() => {
          list.reload();
          setLedgerVersion((version) => version + 1);
        }}
      />
    </div>
  );
}

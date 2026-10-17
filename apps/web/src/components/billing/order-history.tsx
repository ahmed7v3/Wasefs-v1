"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  buttonStyles,
  moneyText,
  periodLabel,
  type BadgeTone,
} from "@wasfa/ui";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchMyOrders } from "../../lib/billing-api";
import { formatDate } from "../../lib/dates";
import { ErrorNotice } from "../error-notice";

import type { MyOrdersResponse } from "@wasfa/shared/schemas/subscriptions";

type Order = MyOrdersResponse["items"][number];

export interface OrderHistoryProps {
  /** Display names of plans and packs by key, from the catalog. */
  names: Readonly<Record<string, string>>;
}

const STATUS: Record<Order["status"], { label: MessageKey; tone: BadgeTone }> = {
  pending_payment: { label: "billing.orders.status.pending_payment", tone: "warning" },
  paid: { label: "billing.orders.status.paid", tone: "success" },
  partially_refunded: { label: "billing.orders.status.partially_refunded", tone: "info" },
  refunded: { label: "billing.orders.status.refunded", tone: "neutral" },
  expired: { label: "billing.orders.status.expired", tone: "neutral" },
  canceled: { label: "billing.orders.status.canceled", tone: "neutral" },
};

function itemText(order: Order, names: Readonly<Record<string, string>>): string {
  if (order.kind === "credit_pack") {
    return order.packKey ? (names[order.packKey] ?? order.packKey) : t("billing.orders.pack");
  }
  const plan = order.planKey ? (names[order.planKey] ?? order.planKey) : t("billing.orders.plan");
  return order.months ? `${plan} · ${periodLabel(order.months)}` : plan;
}

/** The customer's orders, newest first, with the receipt of each paid one and "load more". */
export function OrderHistory({ names }: OrderHistoryProps) {
  const [items, setItems] = useState<Order[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (after?: string) => {
    try {
      const page = await fetchMyOrders(after);
      setItems((current) => (after && current ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !items) {
    return (
      <ErrorNotice
        error={error}
        onRetry={() => {
          void load();
        }}
      />
    );
  }
  if (!items) return <Skeleton className="h-32 w-full" />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title={t("billing.orders.empty")}
        description={t("billing.orders.emptyHint")}
        action={
          <Link href="/pricing" className={buttonStyles()}>
            {t("billing.account.seePlans")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60 bg-surface">
        {items.map((order) => {
          const status = STATUS[order.status];
          return (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base font-semibold text-text">{itemText(order, names)}</span>
                <span className="text-sm text-text-muted">
                  <bdi className="tabular-nums">{order.number}</bdi> · {formatDate(order.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base font-semibold tabular-nums">
                  <bdi>{moneyText(order.totalMinor, order.currency)}</bdi>
                </span>
                <Badge tone={status.tone}>{t(status.label)}</Badge>
                {order.receiptAvailable ? (
                  <Link
                    href={`/billing/orders/${order.id}/receipt`}
                    className={buttonStyles({ variant: "ghost" })}
                  >
                    {t("billing.orders.receipt")}
                    <span className="sr-only"> {order.number}</span>
                  </Link>
                ) : null}
                {order.status === "pending_payment" ? (
                  <Link
                    href={`/checkout/${order.id}`}
                    className={buttonStyles({ variant: "secondary" })}
                  >
                    {t("billing.orders.complete")}
                    <span className="sr-only"> {order.number}</span>
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <ErrorNotice error={error} /> : null}
      {cursor ? (
        <Button
          variant="secondary"
          className="self-center"
          loading={loadingMore}
          onClick={() => {
            setLoadingMore(true);
            void load(cursor).finally(() => {
              setLoadingMore(false);
            });
          }}
        >
          {t("billing.orders.more")}
        </Button>
      ) : null}
    </div>
  );
}

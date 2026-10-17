"use client";

import { t } from "@wasfa/shared/i18n";
import { Skeleton } from "@wasfa/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  fetchInstructions,
  fetchOrderStatus,
  type ManualInstructions,
} from "../../lib/billing-api";
import { ErrorNotice } from "../error-notice";

import { ManualPayment } from "./manual-payment";
import { ExpiredState, FailedState, PaidState, PendingState } from "./order-states";

import type { OrderStatusResponse } from "@wasfa/shared/schemas/billing";

/** Polling cadence: every 2 s for the first 30 s, then every 5 s, and stop after 10 minutes. */
export const POLL_FAST_MS = 2_000;
export const POLL_SLOW_MS = 5_000;
export const POLL_FAST_WINDOW_MS = 30_000;
export const POLL_MAX_MS = 10 * 60_000;

export interface OrderFlowMethod {
  key: string;
  kind: "gateway" | "manual";
}

export interface OrderFlowProps {
  initial: OrderStatusResponse;
  methods: readonly OrderFlowMethod[];
  /** `https://wa.me/...` from the public settings, or null when none is set. */
  supportHref: string | null;
}

type Payment = OrderStatusResponse["payments"][number];

function latestPayment(order: OrderStatusResponse): Payment | undefined {
  return [...order.payments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

const GATEWAY_DEAD = new Set(["failed", "canceled", "expired"]);

/**
 * The page a person lands on after Pay (and the page the gateway returns to). It reads the order,
 * never writes it: only a verified webhook or an admin approval marks anything paid, so polling
 * here just waits for the truth.
 */
export function OrderFlow({ initial, methods, supportHref }: OrderFlowProps) {
  const [order, setOrder] = useState(initial);
  const [instructions, setInstructions] = useState<ManualInstructions | null>(null);
  const [instructionsError, setInstructionsError] = useState<unknown>(null);
  const [stopped, setStopped] = useState(false);
  const [round, setRound] = useState(0);
  const payment = latestPayment(order);
  const manual =
    payment !== undefined && methods.find((m) => m.key === payment.methodKey)?.kind === "manual";
  const pendingOrder = order.status === "pending_payment";
  const paymentStatus = payment?.status;

  const refresh = useCallback(async () => {
    try {
      setOrder(await fetchOrderStatus(initial.id));
    } catch {
      // The next poll tries again; the last known state stays on screen.
    }
  }, [initial.id]);

  useEffect(() => {
    if (!pendingOrder) return;
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setStopped(true);
        return;
      }
      await refresh();
      if (cancelled) return;
      timer = window.setTimeout(
        () => {
          void tick();
        },
        Date.now() - startedAt < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS,
      );
    };
    timer = window.setTimeout(() => {
      void tick();
    }, POLL_FAST_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingOrder, refresh, round]);

  // The instructions carry the account, the reference and the review state: read them again
  // whenever the payment moves (proof sent, rejected, approved).
  useEffect(() => {
    if (!manual || !pendingOrder) return;
    const controller = new AbortController();
    fetchInstructions(initial.id, controller.signal)
      .then((value) => {
        setInstructions(value);
        setInstructionsError(null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setInstructionsError(failure);
      });
    return () => {
      controller.abort();
    };
  }, [manual, pendingOrder, paymentStatus, initial.id]);

  const restart = (): void => {
    setStopped(false);
    setRound((value) => value + 1);
    void refresh();
  };

  let body: ReactNode;
  if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
    body = (
      <PaidState
        free={order.totalMinor === 0 && order.payments.length === 0}
        manual={manual}
        number={order.number}
      />
    );
  } else if (order.status === "expired" || order.status === "canceled") {
    body = <ExpiredState number={order.number} canceled={order.status === "canceled"} />;
  } else if (manual && payment) {
    body = instructions ? (
      <ManualPayment
        instructions={instructions}
        paymentId={payment.id}
        number={order.number}
        supportHref={supportHref}
        onChanged={restart}
      />
    ) : instructionsError ? (
      <ErrorNotice error={instructionsError} onRetry={restart} />
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  } else if (payment && GATEWAY_DEAD.has(payment.status)) {
    body = <FailedState number={order.number} supportHref={supportHref} />;
  } else {
    body = (
      <PendingState
        number={order.number}
        supportHref={supportHref}
        stopped={stopped}
        onRefresh={restart}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-3xl">
          {t("billing.order.title")}
        </h1>
        <p className="text-base text-text-muted">
          {t("billing.order.number", { number: order.number })}
        </p>
      </header>
      {body}
    </div>
  );
}

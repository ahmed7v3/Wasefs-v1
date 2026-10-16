import {
  applyProviderEvent,
  checkPaymentsConsistency,
  expireOrders,
  paymentsToReconcile,
  type Database,
  type PaymentHooks,
} from "@wasfa/db";
import { GatewayUnavailableError, type PaymentGateway } from "@wasfa/shared/gateways";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";
import type { Logger } from "pino";

/** Open gateway payments quiet for this long are asked about (BILLING §5.6). */
export const RECONCILE_QUIET_MS = 10 * 60_000;
/** Expired gateway payments are still asked about for this long: late successes must count. */
export const RECONCILE_LATE_WINDOW_MS = 24 * 60 * 60_000;

export interface ReconcileOutcome {
  checked: number;
  applied: number;
  unavailable: number;
}

/**
 * Asks the provider about each candidate and applies the answer through the same transaction a
 * webhook uses. The poll's event id is `poll:<payment>:<state>`, so a webhook and a poll that
 * report the same outcome cannot both act (and neither can two polls).
 */
export async function reconcilePayments(
  db: Database,
  gateways: (key: string) => Promise<PaymentGateway | null>,
  hooks: PaymentHooks,
  now = new Date(),
): Promise<ReconcileOutcome> {
  const candidates = await paymentsToReconcile(db, now, {
    quietForMs: RECONCILE_QUIET_MS,
    lateWindowMs: RECONCILE_LATE_WINDOW_MS,
  });
  const outcome: ReconcileOutcome = { checked: 0, applied: 0, unavailable: 0 };
  for (const candidate of candidates) {
    if (!candidate.gateway) continue;
    const gateway = await gateways(candidate.gateway);
    if (!gateway) continue;
    outcome.checked++;
    let status;
    try {
      status = await gateway.getStatus(candidate.id, candidate.providerRef);
    } catch (error) {
      if (!(error instanceof GatewayUnavailableError)) throw error;
      outcome.unavailable++;
      continue;
    }
    if (status.state === "pending") continue;
    const result = await applyProviderEvent(
      db,
      {
        provider: candidate.gateway,
        eventId: `poll:${candidate.id}:${status.state}`,
        type: "poll",
        paymentId: candidate.id,
        providerRef: status.providerRef,
        state: status.state,
        amountMinor: status.amountMinor,
        currency: status.currency,
        failureCode: status.failureCode,
        redacted: { source: "reconcile", state: status.state },
      },
      hooks,
      now,
    );
    if (result !== "duplicate" && result !== "ignored") outcome.applied++;
  }
  return outcome;
}

type PaymentsContext = Pick<JobContext, "db" | "logger" | "payments">;

/** `payments.reconcile`, every 5 minutes. */
export async function reconcilePaymentsJob(
  _payload: JobPayload<"payments", "payments.reconcile">,
  context: PaymentsContext,
): Promise<void> {
  const runtime = context.payments;
  if (!runtime) {
    context.logger.warn({ event: "payments.runtime_missing" }, "Reconciliation skipped");
    return;
  }
  const result = await reconcilePayments(context.db, (key) => runtime.gateway(key), runtime.hooks);
  if (result.checked > 0) context.logger.info(result, "Payments reconciled");
}

/** `payments.expire_orders`, every 5 minutes. */
export async function expireOrdersJob(
  _payload: JobPayload<"payments", "payments.expire_orders">,
  { db, logger }: PaymentsContext,
): Promise<void> {
  const result = await expireOrders(db);
  if (result.expired > 0) logger.info(result, "Unpaid orders expired");
}

/**
 * `payments.consistency`, nightly. Like `credits.reconcile`: findings are logged at error level
 * (event `payments.drift`, ids only) and the job does not throw, since a retry cannot fix them.
 */
export async function paymentsConsistencyJob(
  _payload: JobPayload<"payments", "payments.consistency">,
  { db, logger }: PaymentsContext,
): Promise<void> {
  const report = await checkPaymentsConsistency(db);
  logConsistency(report, logger);
}

function logConsistency(
  report: Awaited<ReturnType<typeof checkPaymentsConsistency>>,
  logger: Logger,
): void {
  const drifted =
    report.packsWithoutCredits.length +
    report.paidWithoutPayment.length +
    report.paymentWithoutPaidOrder.length;
  if (drifted > 0) {
    logger.error({ event: "payments.drift", ...report }, "Payments drift detected");
  } else {
    logger.info("Payments consistent");
  }
}

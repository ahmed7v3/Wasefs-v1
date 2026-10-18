import { auditLogs, paymentMethodAccountChanges, paymentMethods, raiseAdminAlert } from "@wasfa/db";
import { and, eq, lte, asc } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const masked = (value: string) =>
  value.includes("@")
    ? `${value.slice(0, 2)}***${value.slice(value.indexOf("@"))}`
    : `${value.slice(0, 3)}*****${value.slice(-3)}`;

export async function applyDuePaymentMethodChangesJob(
  _payload: JobPayload<"payments", "payment-methods.apply-due">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
): Promise<void> {
  const applied = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ change: paymentMethodAccountChanges, method: paymentMethods })
      .from(paymentMethodAccountChanges)
      .innerJoin(paymentMethods, eq(paymentMethods.id, paymentMethodAccountChanges.methodId))
      .where(
        and(
          eq(paymentMethodAccountChanges.status, "pending"),
          lte(paymentMethodAccountChanges.effectiveAt, new Date()),
        ),
      )
      .orderBy(asc(paymentMethodAccountChanges.effectiveAt))
      .limit(50)
      .for("update", { skipLocked: true });
    for (const { change, method } of rows) {
      await tx
        .update(paymentMethods)
        .set({
          accountDisplay: change.newAccountDisplay,
          accountHolder: change.newAccountHolder,
          updatedAt: new Date(),
        })
        .where(eq(paymentMethods.id, method.id));
      await tx
        .update(paymentMethodAccountChanges)
        .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
        .where(eq(paymentMethodAccountChanges.id, change.id));
      await tx.insert(auditLogs).values({
        actorId: null,
        action: "payment_method.account_change_applied",
        targetType: "payment_method",
        targetId: method.key,
        before: {
          accountDisplay: masked(change.oldAccountDisplay),
          accountHolder: change.oldAccountHolder,
        },
        after: {
          accountDisplay: masked(change.newAccountDisplay),
          accountHolder: change.newAccountHolder,
          changeId: change.id,
        },
      });
      await raiseAdminAlert(tx, {
        kind: "payment_method.account_change_applied",
        severity: "critical",
        refType: "payment_method_account_change",
        refId: change.id,
        summary: `${method.nameEn}: scheduled payment account change has been applied.`,
        link: `/admin/billing/methods/${method.key}/account-change`,
      });
    }
    return rows.length;
  });
  if (applied) logger.info({ applied }, "Scheduled payment method account changes applied");
}

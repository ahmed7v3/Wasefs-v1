"use client";

import { t } from "@wasfa/shared/i18n";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { buttonStyles } from "@wasfa/ui";
import { Tags } from "lucide-react";
import Link from "next/link";

import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { AssignmentsPanel } from "./assignments-panel";

export interface PlansViewProps {
  /** `plans.write`: assign a plan and end an assignment. */
  canWrite: boolean;
  /** `users.read`: the assign dialog can search users by name or email. */
  canSearchUsers: boolean;
}

/**
 * `/admin/plans`: who has a plan given by hand (outside a payment), and giving or ending one.
 * Creating, editing, pricing, ordering and deleting plans all live on /admin/billing/plans.
 */
export function PlansView({ canWrite, canSearchUsers }: PlansViewProps) {
  const resource = useResource("/admin/plans", planListResponseSchema);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-primary-soft p-4">
        <p className="max-w-2xl text-sm text-text">{t("admin.plans.assignOnlyNote")}</p>
        <Link href="/admin/billing/plans" className={buttonStyles({ variant: "secondary" })}>
          <Tags aria-hidden className="size-5" />
          {t("admin.plans.goToPlans")}
        </Link>
      </div>
      {resource.status === "error" ? (
        <ErrorNotice error={resource.error} onRetry={resource.reload} />
      ) : (
        <AssignmentsPanel
          plans={resource.status === "ready" ? resource.data.items : []}
          canWrite={canWrite}
          canSearchUsers={canSearchUsers}
        />
      )}
    </div>
  );
}

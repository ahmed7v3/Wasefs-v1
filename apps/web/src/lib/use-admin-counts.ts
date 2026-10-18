"use client";

import { useEffect, useState } from "react";

import { countsSchema, type CountsView } from "./admin-billing-schemas";
import { api } from "./api-client";

/** The permissions that make `GET /admin/billing/counts` worth asking (it answers null per count otherwise). */
const COUNT_PERMISSIONS = ["payments.review", "withdrawals.review", "referrals.read"] as const;

export function wantsCounts(permissions: readonly string[]): boolean {
  return COUNT_PERMISSIONS.some((permission) => permissions.includes(permission));
}

/**
 * Work-waiting counts for the sidebar badges. A count the account may not see is `null` and its
 * badge stays hidden; a failed request just shows no badges (they are a hint, not a gate).
 */
export function useAdminCounts(permissions: readonly string[]): CountsView | null {
  const enabled = wantsCounts(permissions);
  const [counts, setCounts] = useState<CountsView | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api("/admin/billing/counts", { schema: countsSchema, signal: controller.signal }).then(
      (value) => {
        setCounts(value);
      },
      () => {
        setCounts(null);
      },
    );
    return () => {
      controller.abort();
    };
  }, [enabled]);

  return counts;
}

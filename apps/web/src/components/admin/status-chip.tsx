import { Badge, type BadgeTone } from "@wasfa/ui";
import { Circle, CircleCheck, CircleX, Clock, Info } from "lucide-react";

import { tOr } from "../../lib/admin-format";

import type { LucideIcon } from "lucide-react";

/*
 * One status chip for every billing record: an icon AND a word (colour is never the only signal,
 * ADMIN-CONSOLE-SPEC §1.7). The wording is `admin.revenue.status.<kind>.<status>`; a status this
 * build does not know shows its raw code instead of a hole.
 */

export type StatusKind = "payment" | "order" | "subscription" | "refund" | "discount";

const TONES: Record<StatusKind, Record<string, BadgeTone>> = {
  payment: {
    succeeded: "success",
    awaiting_review: "warning",
    awaiting_second_approval: "warning",
    awaiting_customer: "warning",
    processing: "info",
    created: "neutral",
    failed: "danger",
    rejected: "danger",
    canceled: "neutral",
    expired: "neutral",
    partially_refunded: "info",
    refunded: "neutral",
  },
  order: {
    paid: "success",
    pending_payment: "warning",
    partially_refunded: "info",
    refunded: "neutral",
    expired: "neutral",
    canceled: "neutral",
  },
  subscription: {
    active: "success",
    trialing: "info",
    grace: "warning",
    expired: "neutral",
    canceled: "neutral",
  },
  refund: {
    requested: "warning",
    approved: "info",
    succeeded: "success",
    failed: "danger",
    rejected: "danger",
  },
  discount: {
    active: "success",
    scheduled: "info",
    draft: "neutral",
    paused: "warning",
    ended: "neutral",
  },
};

const ICONS: Record<BadgeTone, LucideIcon> = {
  success: CircleCheck,
  warning: Clock,
  danger: CircleX,
  info: Info,
  neutral: Circle,
};

export function StatusChip({ kind, status }: { kind: StatusKind; status: string }) {
  const tone = TONES[kind][status] ?? "neutral";
  const Icon = ICONS[tone];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden className="size-3.5" />
      {tOr(`admin.revenue.status.${kind}.${status}`, status)}
    </Badge>
  );
}

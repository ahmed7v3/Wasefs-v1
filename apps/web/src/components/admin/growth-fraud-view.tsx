"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  bulkFraudResultSchema,
  fraudListSchema,
  type FraudAction,
  type FraudItem,
} from "@wasfa/shared/schemas/admin-growth";
import { Button, Checkbox, useToast } from "@wasfa/ui";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useCursorList } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { EmptyHint } from "./empty-hint";
import { ReasonDialog } from "./reason-dialog";
import { StatusChip } from "./status-chip";

function Row({ item, checked, onToggle }: { item: FraudItem; checked: boolean; onToggle: () => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4" data-testid="fraud-item">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          name={`pick-${item.referralId}`}
          checked={checked}
          onChange={onToggle}
          label={t("admin.fraud.pair", { referrer: item.referrer?.initials ?? "—", referee: item.referee.initials })}
        />
        <StatusChip kind="referral" status={item.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {item.flags.map((flag) => (
          <span key={flag} className="rounded bg-warning-soft px-2 py-0.5 text-text">{tOr(`admin.growth.flag.${flag}`, flag)}</span>
        ))}
        <span className="text-text-muted">{t("admin.fraud.score", { score: formatNumber(item.fraudScore) })}</span>
        <span className="text-text-muted">{t("admin.fraud.pending", { points: formatNumber(item.pendingPoints) })}</span>
        {item.referrerInvitedBy ? <span className="text-text-muted">{t("admin.fraud.chain", { initials: item.referrerInvitedBy.initials })}</span> : null}
        <span className="text-text-muted tabular-nums">{formatDateTime(item.createdAt)}</span>
      </div>
      {item.heldDecisions.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {item.heldDecisions.map((decision) => (
            <li key={decision.id}>{`${tOr(`admin.growth.event.${decision.event}`, decision.event)} · ${formatNumber(decision.points)} · ${tOr(`admin.fraud.reason.${decision.reason ?? ""}`, decision.reason ?? "")}`}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * `/admin/growth/fraud` (ADMIN-CONSOLE-SPEC §6.2): held referrals with their evidence, picked one by
 * one or all at once, and Release / Void / Block referrer with a reason. Every action is audited.
 */
export function GrowthFraudView({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const list = useCursorList("/admin/growth/fraud", "", fraudListSchema);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [action, setAction] = useState<FraudAction | null>(null);

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (list.status === "error") return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const items = list.items;
  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => { setPicked(new Set(items.map((item) => item.referralId))); }} disabled={items.length === 0}>
            {t("admin.fraud.pickAll")}
          </Button>
          {(["release", "void", "block_referrer"] as const).map((value) => (
            <Button
              key={value}
              name={`fraud-${value}`}
              variant={value === "release" ? "primary" : value === "void" ? "secondary" : "danger"}
              disabled={picked.size === 0}
              onClick={() => { setAction(value); }}
            >
              {t(`admin.fraud.action.${value}` as MessageKey, { count: formatNumber(picked.size) })}
            </Button>
          ))}
        </div>
      ) : null}
      {list.status === "ready" && items.length === 0 ? (
        <EmptyHint icon={<ShieldCheck />} title={t("admin.fraud.empty")} hint={t("admin.fraud.emptyHint")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <Row key={item.referralId} item={item} checked={picked.has(item.referralId)} onToggle={() => { toggle(item.referralId); }} />
          ))}
        </ul>
      )}
      {list.nextCursor ? (
        <Button variant="secondary" loading={list.loadingMore} onClick={list.loadMore}>{t("admin.table.loadMore")}</Button>
      ) : null}
      <ReasonDialog
        open={action !== null}
        onOpenChange={(open) => { if (!open) setAction(null); }}
        title={action ? t(`admin.fraud.action.${action}` as MessageKey, { count: formatNumber(picked.size) }) : ""}
        effect={action ? t(`admin.fraud.effect.${action}` as MessageKey) : ""}
        confirmLabel={t("admin.fraud.confirm")}
        tone={action === "release" ? "primary" : "danger"}
        onConfirm={async (reason) => {
          if (!action) return;
          const result = await api("/admin/growth/fraud/bulk", {
            method: "POST",
            body: { referralIds: [...picked], action, reason },
            schema: bulkFraudResultSchema,
          });
          const done = result.results.filter((row) => row.outcome === "done").length;
          toast({ tone: "success", title: t("admin.fraud.done", { done: formatNumber(done), total: formatNumber(result.results.length) }) });
          setAction(null);
          setPicked(new Set());
          list.reload();
        }}
      />
    </div>
  );
}
